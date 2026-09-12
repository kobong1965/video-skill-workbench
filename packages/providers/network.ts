import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';

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
export async function requestBytes(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string | FormData; timeoutSeconds?: number; maxBytes?: number; allowSignedQuery?: boolean; onDispatch?: () => Promise<void> } = {}) {
  const candidate = new URL(urlString);
  const query = candidate.search;
  if (init.allowSignedQuery) candidate.search = '';
  const url = validateEndpoint(candidate.href);
  if (init.allowSignedQuery) url.search = query;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ProviderError('rejected', '服务地址解析到受限网络，已阻止请求');
  const chosen = addresses[0];
  const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
    if (options.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
    else callback(null, chosen.address, chosen.family);
  } } });
  let started = false;
  try {
    await init.onDispatch?.();
    started = true;
    const response = await undiciFetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body as never, redirect: 'manual', signal: AbortSignal.timeout((init.timeoutSeconds ?? 120) * 1000), dispatcher });
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
    if (!started) throw new ProviderError('rejected', '本机发送准备失败，尚未请求外部生成');
    throw new ProviderError('unknown', '网络中断或响应超时，服务端可能已执行，请核对后决定是否重试');
  } finally { await dispatcher.close(); }
}
