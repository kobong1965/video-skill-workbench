import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import * as network from '../../packages/providers/network';
import { assertProvider, providerSchema, publicProvider } from '../../packages/providers/config';
import { systemProxyFor } from '../../packages/providers/system-proxy';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../../packages/providers/system-proxy', () => ({ systemProxyFor: vi.fn() }));
vi.mock('undici', async original => ({ ...await original<typeof import('undici')>(), fetch: vi.fn() }));
const resolve = vi.mocked(lookup);
const fetch = vi.mocked(undiciFetch);
const addresses = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
afterEach(() => vi.resetAllMocks());

describe('生成服务超时与连接回退', () => {
  it('默认不限制生成等待，仍接受明确设置的超时', () => {
    const value = { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test' };
    expect(providerSchema.parse(value).timeoutSeconds).toBe(0);
    for (const seconds of [0, 120, 600, 3600]) expect(providerSchema.parse({ ...value, timeoutSeconds: seconds }).timeoutSeconds).toBe(seconds);
    for (const seconds of [-1, 3601, 1.5]) expect(providerSchema.safeParse({ ...value, timeoutSeconds: seconds }).success).toBe(false);
  });

  it('等待为0时不创建立即触发的AbortSignal', async () => {
    resolve.mockResolvedValue(addresses as never);
    fetch.mockResolvedValue(new Response('completed') as never);
    expect((await network.requestBytes('https://api.example.com/v1', { timeoutSeconds: 0 })).toString()).toBe('completed');
    expect(fetch.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('默认等待不被Undici的300秒headers/body或10秒connect默认值截断', async () => {
    const options = network.providerAgentOptions(addresses, 0);
    expect(options).toMatchObject({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 60000, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 });
    const agent = new Agent(options);
    await agent.close();
    const lookup = (options.connect as { lookup: import('node:net').LookupFunction }).lookup;
    const callback = vi.fn();
    lookup!('api.example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, addresses);
  });

  it('自定义更长等待同时更新headers与body超时', () => {
    expect(network.providerAgentOptions(addresses, 600)).toMatchObject({ headersTimeout: 600000, bodyTimeout: 600000 });
  });

  it('代理请求与CONNECT通道均使用相同等待配置，保留TLS证书验证', async () => {
    const options = network.providerProxyOptions('http://127.0.0.1:7897/', 0);
    expect(options).toMatchObject({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 60000 });
    expect(options.clientFactory).toBeTypeOf('function');
    expect(options.requestTls).not.toHaveProperty('rejectUnauthorized', false);
    expect(options.proxyTls).not.toHaveProperty('rejectUnauthorized', false);
    const agent = new ProxyAgent(options);
    await agent.close();
  });

  it('仍拒绝混入内网的DNS地址，不发送生成请求', async () => {
    resolve.mockResolvedValue([...addresses, { address: '127.0.0.1', family: 4 }] as never);
    await expect(network.requestBytes('https://api.example.com/v1')).rejects.toMatchObject({ classification: 'rejected', message: expect.stringContaining('受限网络') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('单人模式沿用本机代理，让代理解析服务域名而非固定本机错误DNS', async () => {
    vi.mocked(systemProxyFor).mockResolvedValue('http://127.0.0.1:7897/');
    fetch.mockResolvedValue(new Response('through-proxy') as never);
    expect((await network.requestBytes('https://api.example.com/v1', { singleUserMode: true })).toString()).toBe('through-proxy');
    expect(systemProxyFor).toHaveBeenCalledWith(new URL('https://api.example.com/v1'));
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]?.dispatcher).toBeInstanceOf((await import('undici')).ProxyAgent);
  });

  it('多人服务不隐式读取管理员电脑的代理', async () => {
    resolve.mockResolvedValue(addresses as never);
    fetch.mockResolvedValue(new Response('direct') as never);
    await network.requestBytes('https://api.example.com/v1');
    expect(systemProxyFor).not.toHaveBeenCalled();
  });

  it('代理模式仍拒绝目标中的本机及内网字面地址', async () => {
    await expect(network.requestBytes('https://127.0.0.1/v1', { singleUserMode: true })).rejects.toThrow('内网');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', '连接生成服务超时'],
    ['UND_ERR_HEADERS_TIMEOUT', '等待生成服务响应超时'],
    ['UND_ERR_BODY_TIMEOUT', '接收生成结果超时'],
    ['ECONNRESET', '连接被重置'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS'],
  ])('保留可诊断原因%s且不暴露第三方错误中的密钥', async (code, message) => {
    resolve.mockResolvedValue(addresses as never);
    fetch.mockRejectedValue(new TypeError('fetch failed', { cause: Object.assign(new Error('https://bad.example/?api_key=secret-key'), { code }) }));
    const failure = await network.requestBytes('https://api.example.com/v1').catch(error => error);
    expect(failure).toMatchObject({ classification: 'unknown', message: expect.stringContaining(message) });
    expect(failure.message).toContain(code);
    expect(JSON.stringify({ message: failure.message, raw: failure.raw })).not.toMatch(/secret-key|bad\.example/);
  });

  it('DNS解析失败显示明确原因且标记尚未发送请求', async () => {
    resolve.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND secret.example'), { code: 'ENOTFOUND' }));
    await expect(network.requestBytes('https://api.example.com/v1')).rejects.toMatchObject({ classification: 'rejected', message: expect.stringContaining('DNS') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('单人模式允许直接尝试已填密钥的视觉接口，多人模式保留能力确认', () => {
    const config = { ...providerSchema.parse({ enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test' }), sealedKey: 'sealed' };
    expect(assertProvider(config, 'text', true)).toBe(config);
    expect(() => assertProvider(config, 'text')).toThrow('商品图片');
  });

  it('公开配置返回实际生效等待时长但不改写已保存配置', () => {
    const config = { ...providerSchema.parse({ enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test', timeoutSeconds: 300 }), sealedKey: 'sealed' };
    expect(publicProvider(config, true)).toMatchObject({ timeoutSeconds: 0 });
    expect(publicProvider(config)).toMatchObject({ timeoutSeconds: 300 });
    expect(config.timeoutSeconds).toBe(300);
  });
});
