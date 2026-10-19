import { cloneElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode, useState } from 'react';
import './controls.css';

export function Icon({ name }: { name: string }) {
  const icons: Record<string, ReactNode> = {
    create: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7m-3.5-3.5v7"/></>,
    library: <><path d="M5 6h14v15H5zM8 3h11M9 10h6M9 14h6"/></>,
    history: <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l4 2"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
    settings: <><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 11.5-1L20 9M4 15l2.5 3A7 7 0 0 0 18 17"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    save: <><path d="M20 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h13l4 4v13a1 1 0 0 1-1 1Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/></>,
    import: <><path d="M4 5h16v14H4M10 12H2m5-4 4 4-4 4"/><path d="M15 9h2M15 13h2"/></>,
    undo: <><path d="M3 10h6M3 10V4"/><path d="M3 10a8 8 0 1 1 2 9"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    logout: <><path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/></>,
    play: <path d="m9 5 11 7-11 7Z"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    chevron: <path d="m6 9 6 6 6-6"/>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name] ?? icons.create}</svg>;
}
export function Message({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><Icon name="library"/><h2>{title}</h2><div>{children}</div></div>; }
export function ControlHint({ label, children }: { label: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const describedBy = [children.props['aria-describedby'], id].filter(Boolean).join(' ');
  return <span className="control-hint"
    onPointerEnter={() => { setHovered(true); setDismissed(false); }}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => { setFocused(true); setDismissed(false); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setDismissed(true); } }}>
    {cloneElement(children, { 'aria-describedby': describedBy })}
    <span className="control-hint-content" role="tooltip" id={id} hidden={!open}>{label}</span>
  </span>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); const close = (event: Event) => { event.preventDefault(); closeRef.current(); }; dialog.addEventListener('cancel', close); return () => { dialog.removeEventListener('cancel', close); dialog.close(); }; }, []);
  return <dialog ref={ref} className="modal" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="关闭窗口" onClick={onClose}><Icon name="close"/></button></header>{children}</dialog>;
}
type AsyncButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> & { children: ReactNode; action: () => Promise<unknown> };
export function AsyncButton({ children, action, className = '', disabled = false, ...props }: AsyncButtonProps) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <><button {...props} className={className} disabled={busy || disabled} aria-busy={busy || undefined} onClick={async () => { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? '处理中' : children}</button>{error ? <Message error>{error}</Message> : null}</>;
}
export const statusLabel: Record<string, string> = { draft: '已保存', queued: '排队中', processing: '生成中', running: '生成中', succeeded: '已完成', awaiting_confirmation: '待确认脚本', awaiting_assets: '待准备参考图', awaiting_image_confirmation: '待确认图片', completed: '已完成', failed: '未成功', invalid: '结果需修正', unknown: '结果待确认', partial: '部分完成' };
export const kindLabel: Record<string, string> = { full: '全片', opening: '开头', detail: '细节', outfit: '上身', comparison: '对比', person: '人物', scene: '场景', angle: '人物角度', storyboard: '故事面板', tailframe: '真实尾帧' };
