import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { Agent, Pool, ProxyAgent, fetch as undiciFetch } from 'undici';
import { systemProxyFor } from './system-proxy';

export class ProviderError extends Error {
  constructor(public classification: 'rejected' | 'unknown' | 'invalid', message: string, public raw?: string) { super(message); }
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
  return false;
}
export function validateEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('API 地址无效'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443')) throw new Error('API 仅支持不含账号密码和查询参数的 HTTPS 地址');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host) && !isPublicAddress(host))) throw new Error('API 地址不能指向本机、内网或元数据服务');
  return url;
}
export function providerAgentOptions(addresses: LookupAddress[], timeoutSeconds = 0): Agent.Options {
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ProviderError('rejected', '服务地址解析到受限网络，已阻止请求');
  return {
    headersTimeout: timeoutSeconds * 1000, bodyTimeout: timeoutSeconds * 1000,
    connectTimeout: 60000, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250,
    connect: { timeout: 60000, lookup: (_host, options, callback) => {
      const eligible = options.family === 4 || options.family === 6 ? addresses.filter(item => item.family === options.family) : addresses;
      if (!eligible.length) { callback(Object.assign(new Error('No eligible public address'), { code: 'ENOTFOUND' }), '', 0); return; }
      if (options.all) callback(null, eligible);
      else callback(null, eligible[0].address, eligible[0].family);
    } },
  };
}

export function providerProxyOptions(uri: string, timeoutSeconds = 0): ProxyAgent.Options {
  const proxyUrl = new URL(uri);
  const timeouts = { headersTimeout: timeoutSeconds * 1000, bodyTimeout: timeoutSeconds * 1000, connectTimeout: 60000 };
  return {
    uri, ...timeouts,
    requestTls: { port: 443, rejectUnauthorized: true },
    proxyTls: { port: Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80), rejectUnauthorized: true, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 },
    // ProxyAgent creates a separate Pool for CONNECT; it has its own defaults.
    clientFactory: (origin, options) => new Pool(origin, { ...options, ...timeouts }),
  };
}

function networkFailure(error: unknown, started: boolean) {
  const descriptions: Record<string, string> = {
    UND_ERR_CONNECT_TIMEOUT: '连接生成服务超时（60秒）',
    UND_ERR_HEADERS_TIMEOUT: '等待生成服务响应超时', UND_ERR_BODY_TIMEOUT: '接收生成结果超时',
    ETIMEDOUT: '连接生成服务超时', TimeoutError: '生成等待达到设置的超时时间',
    ENOTFOUND: '生成服务域名DNS解析失败', EAI_AGAIN: '生成服务域名DNS暂时无法解析',
    ECONNRESET: '与生成服务的连接被重置', UND_ERR_SOCKET: '与生成服务的连接意外中断',
    ECONNREFUSED: '生成服务或本机代理拒绝连接', ENETUNREACH: '无法连接生成服务所在网络', EHOSTUNREACH: '无法连接生成服务地址',
    ERR_TLS_CERT_ALTNAME_INVALID: '生成服务TLS证书与域名不匹配', CERT_HAS_EXPIRED: '生成服务TLS证书已过期',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '生成服务TLS证书无法验证', DEPTH_ZERO_SELF_SIGNED_CERT: '生成服务TLS证书不受信任',
    SELF_SIGNED_CERT_IN_CHAIN: '生成服务TLS证书链不受信任', CERT_NOT_YET_VALID: '生成服务TLS证书尚未生效',
    ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE: '生成服务TLS握手失败', EPROTO: '生成服务TLS或连接协议握手失败',
  };
  const queue: unknown[] = [error]; const seen = new Set<unknown>();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const cause = item as { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
    const code = cause.code && Object.hasOwn(descriptions, cause.code) ? cause.code : cause.name === 'TimeoutError' ? cause.name : undefined;
    if (code) return new ProviderError(started ? 'unknown' : 'rejected', `${descriptions[code]}（${code}），请检查中转站与网络连接后重试`);
    queue.push(cause.cause, ...(Array.isArray(cause.errors) ? cause.errors : []));
  }
  return new ProviderError(started ? 'unknown' : 'rejected', started ? '与生成服务的网络连接中断，请检查中转站与网络连接后重试' : '本机发送准备失败，尚未请求外部生成');
}

export async function requestBytes(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string | FormData; timeoutSeconds?: number; maxBytes?: number; allowSignedQuery?: boolean; singleUserMode?: boolean; onDispatch?: () => Promise<void> } = {}) {
  const candidate = new URL(urlString);
  const query = candidate.search;
  if (init.allowSignedQuery) candidate.search = '';
  const url = validateEndpoint(candidate.href);
  if (init.allowSignedQuery) url.search = query;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const timeoutSeconds = init.timeoutSeconds ?? 0;
  let dispatcher: Agent | ProxyAgent | undefined;
  let started = false;
  try {
    const proxy = init.singleUserMode ? await systemProxyFor(url) : null;
    if (proxy) {
      dispatcher = new ProxyAgent(providerProxyOptions(proxy, timeoutSeconds));
    } else {
      const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
      dispatcher = new Agent(providerAgentOptions(addresses, timeoutSeconds));
    }
    await init.onDispatch?.();
    started = true;
    const response = await undiciFetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body as never, redirect: 'manual', ...(timeoutSeconds > 0 ? { signal: AbortSignal.timeout(timeoutSeconds * 1000) } : {}), dispatcher });
    if (!response.ok) {
      await response.body?.cancel();
      const rejected = [400, 401, 403, 404, 413, 422, 429].includes(response.status);
      throw new ProviderError(rejected ? 'rejected' : 'unknown', response.status === 401 || response.status === 403 ? '接口鉴权失败，请管理员检查密钥和权限' : response.status === 429 ? '接口限流，请稍后手动重试' : `服务返回 HTTP ${response.status}${rejected ? '，请求被拒绝' : '，执行结果待确认'}`);
    }
    const limit = init.maxBytes ?? 3 * 1024 * 1024;
    const chunks: Uint8Array[] = []; let size = 0;
    if (!response.body) throw new ProviderError('invalid', '服务返回空响应');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new ProviderError('invalid', '服务响应超过容量限制');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw networkFailure(error, started);
  } finally { await dispatcher?.destroy(); }
}
