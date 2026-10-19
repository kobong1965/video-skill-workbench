import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

function proxyUrl(value: string) {
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.pathname !== '/') return null;
    return url.href;
  } catch { return null; }
}

export function parseWindowsProxy(value: string) {
  const entries = value.trim().split(';').map(part => part.trim()).filter(Boolean);
  const https = entries.find(part => /^https=/i.test(part));
  if (https) return proxyUrl(https.slice(https.indexOf('=') + 1));
  return entries.length === 1 && !entries[0].includes('=') ? proxyUrl(entries[0]) : null;
}

function bypassProxy(url: URL, entries: string) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return entries.split(/[,\s]+/).some(entry => {
    if (entry === '*') return true;
    const [domain, port] = entry.toLowerCase().replace(/^\*?\./, '').split(':');
    return Boolean(domain) && (!port || port === (url.port || '443')) && (hostname === domain || hostname.endsWith(`.${domain}`));
  });
}

export async function systemProxyFor(url: URL): Promise<string | null> {
  if (bypassProxy(url, process.env.no_proxy || process.env.NO_PROXY || '')) return null;
  const environment = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  if (environment) return proxyUrl(environment.trim());
  if (process.platform !== 'win32') return null;
  try {
    const registry = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const options = { windowsHide: true, timeout: 3000, maxBuffer: 32768, encoding: 'utf8' as const };
    const [enabled, server] = await Promise.all([
      promisify(execFile)('reg.exe', ['query', registry, '/v', 'ProxyEnable'], options),
      promisify(execFile)('reg.exe', ['query', registry, '/v', 'ProxyServer'], options),
    ]);
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled.stdout)) return null;
    const value = server.stdout.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1];
    return value ? parseWindowsProxy(value) : null;
  } catch { return null; }
}
