import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { parseWindowsProxy, systemProxyFor } from '../../packages/providers/system-proxy';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

function clearProxyEnvironment() {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) vi.stubEnv(key, '');
}

it('解析Windows全局与按协议代理，优先HTTPS地址', () => {
  expect(parseWindowsProxy('127.0.0.1:7897')).toBe('http://127.0.0.1:7897/');
  expect(parseWindowsProxy('http=localhost:8888;https=127.0.0.1:7897;socks=localhost:9999')).toBe('http://127.0.0.1:7897/');
  expect(parseWindowsProxy('https=https://proxy.example:8443')).toBe('https://proxy.example:8443/');
  expect(parseWindowsProxy('file:///c:/bad')).toBeNull();
});

it('优先使用明确设置的环境HTTPS代理，不读注册表', async () => {
  clearProxyEnvironment(); vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897');
  expect(await systemProxyFor(new URL('https://api.example.com/v1'))).toBe('http://127.0.0.1:7897/');
  expect(execFile).not.toHaveBeenCalled();
});

it('尊重NO_PROXY中域名边界，避免把相似外部域名误当免代理', async () => {
  clearProxyEnvironment(); vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897'); vi.stubEnv('NO_PROXY', '.example.com, exact.test:443');
  expect(await systemProxyFor(new URL('https://api.example.com/v1'))).toBeNull();
  expect(await systemProxyFor(new URL('https://exact.test/v1'))).toBeNull();
  expect(await systemProxyFor(new URL('https://notexample.com/v1'))).toBe('http://127.0.0.1:7897/');
});

it('API URL不会被当代理配置，环境代理里的查询与无效协议被拒绝', async () => {
  clearProxyEnvironment(); vi.stubEnv('HTTPS_PROXY', 'https://proxy.example/?key=secret');
  expect(await systemProxyFor(new URL('https://api.example.com/v1'))).toBeNull();
});

it('Windows启用代理且无环境变量时读取当前用户代理设置', async () => {
  clearProxyEnvironment();
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, result: { stdout: string; stderr: string }) => void;
    const query = args[1] as string[];
    callback(null, { stdout: query.includes('ProxyEnable') ? '    ProxyEnable    REG_DWORD    0x1\r\n' : '    ProxyServer    REG_SZ    127.0.0.1:7897\r\n', stderr: '' });
    return {} as never;
  });
  expect(await systemProxyFor(new URL('https://api.example.com/v1'))).toBe('http://127.0.0.1:7897/');
  expect(execFile).toHaveBeenCalledTimes(2);
});
