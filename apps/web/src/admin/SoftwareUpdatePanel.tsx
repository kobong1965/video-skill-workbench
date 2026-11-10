import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../api';
import { Icon } from '../ui';
import './settings.css';

const releasesUrl = 'https://github.com/kobong1965/video-skill-workbench/releases/latest';
const unavailable = '当前桌面版本尚未提供更新入口，请从 GitHub 下载新版后启动。';
type UpdateAction = 'info' | 'open';
type BridgeEvent = { data: unknown };
type DesktopBridge = {
  postMessage: (message: { type: 'vsw-software-update'; action: UpdateAction; requestId: string }) => void;
  addEventListener: (type: 'message', listener: (event: BridgeEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: BridgeEvent) => void) => void;
};
type Pending = { requestId: string; action: UpdateAction; timeout: ReturnType<typeof setTimeout> };

function desktopBridge(): DesktopBridge | null {
  const bridge = (window as Window & { chrome?: { webview?: Partial<DesktopBridge> } }).chrome?.webview;
  return bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function'
    && typeof bridge.removeEventListener === 'function' ? bridge as DesktopBridge : null;
}

export function SoftwareUpdatePanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [notice, setNotice] = useState('正在读取桌面版本…');
  const [failed, setFailed] = useState(false);
  const [needsDownload, setNeedsDownload] = useState(false);
  const [copied, setCopied] = useState(false);
  const bridge = useRef<DesktopBridge | null>(null);
  const pending = useRef<Pending | null>(null);
  const mounted = useRef(false);

  const request = useCallback((action: UpdateAction) => {
    if (!mounted.current || pending.current) return;
    setCopied(false);
    if (!bridge.current) {
      setNotice(unavailable); setNeedsDownload(true); setFailed(false);
      return;
    }
    const requestId = crypto.randomUUID();
    setBusy(action); setFailed(false);
    setNotice(action === 'open' ? '正在打开更新窗口…' : '正在读取桌面版本…');
    const timeout = setTimeout(() => {
      if (!mounted.current || pending.current?.requestId !== requestId) return;
      pending.current = null; setBusy(null); setNeedsDownload(true); setFailed(false);
      setNotice(unavailable);
    }, 3000);
    pending.current = { requestId, action, timeout };
    try {
      bridge.current.postMessage({ type: 'vsw-software-update', action, requestId });
    } catch {
      clearTimeout(timeout); pending.current = null; setBusy(null);
      setNotice('暂时无法连接桌面更新入口，请重试，或从 GitHub 下载新版。');
      setNeedsDownload(true); setFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const currentBridge = desktopBridge();
    bridge.current = currentBridge;
    const receive = ({ data }: BridgeEvent) => {
      if (!mounted.current || !data || typeof data !== 'object' || !pending.current) return;
      const value = data as Record<string, unknown>;
      if (value.type !== 'vsw-software-update' || value.requestId !== pending.current.requestId
        || typeof value.opened !== 'boolean'
        || !(value.currentVersion === null || (typeof value.currentVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.currentVersion)))
        || (value.error !== undefined && typeof value.error !== 'string')) return;
      const action = pending.current.action;
      clearTimeout(pending.current.timeout); pending.current = null; setBusy(null);
      setVersion(value.currentVersion as string | null);
      if (value.error) {
        setNotice(value.error as string); setFailed(true); setNeedsDownload(true);
      } else if (action === 'open' && !value.opened) {
        setNotice('更新窗口尚未打开，请重试。'); setFailed(true); setNeedsDownload(true);
      } else {
        setNotice(action === 'open' ? '已打开更新窗口，请在窗口中查看检查结果和下载进度。' : '点击检查 GitHub 最新稳定版，可下载并校验程序包。');
        setFailed(false); setNeedsDownload(false);
      }
    };
    currentBridge?.addEventListener('message', receive);
    request('info');
    return () => {
      mounted.current = false;
      currentBridge?.removeEventListener('message', receive);
      if (pending.current) clearTimeout(pending.current.timeout);
      pending.current = null; bridge.current = null;
    };
  }, [request]);

  return <section className="panel software-update-panel" aria-labelledby="software-update-heading">
    <div className="software-update-header">
      <div className="software-update-intro"><span className="software-update-icon"><Icon name="refresh"/></span><div><h2 id="software-update-heading">软件更新</h2><p>仅更新软件程序；脚本、素材和本机配置继续保留。</p></div></div>
      <button type="button" className="primary software-update-check" disabled={busy !== null} aria-busy={busy !== null || undefined} onClick={() => request('open')}><Icon name="refresh"/>{busy === 'open' ? '正在打开…' : '检查更新'}</button>
    </div>
    <div className="software-update-meta"><span>当前桌面版本</span><strong>{version ? `v${version}` : busy === 'info' ? '正在读取…' : '未能读取'}</strong><span className="tag blue">GitHub 稳定版</span></div>
    <p className={`software-update-status${failed ? ' software-update-error' : ''}`} role={failed ? 'alert' : 'status'}>{notice}</p>
    {needsDownload ? <div className="software-update-fallback"><a href={releasesUrl} target="_blank" rel="noreferrer">GitHub 下载新版 ↗</a><button type="button" className="text-button" onClick={async () => { try { await copyText(releasesUrl); if (mounted.current) setCopied(true); } catch { if (mounted.current) { setNotice(`请在浏览器打开：${releasesUrl}`); setFailed(true); } } }}>{copied ? '下载链接已复制' : '复制下载链接'}</button></div> : null}
  </section>;
}
