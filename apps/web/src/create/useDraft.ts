import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

export function useDraft(input: Record<string, unknown>, active: boolean, initialId?: string) {
  const id = useRef<string | undefined>(initialId); const latest = useRef(input); latest.current = input;
  const enabled = useRef(active); enabled.current = active;
  const chain = useRef(Promise.resolve()); const [status, setStatus] = useState(''); const [error, setError] = useState('');
  const [lastSaved, setLastSaved] = useState(''); const serialized = JSON.stringify(input);
  const save = useCallback(async () => {
    if (!enabled.current) return;
    const snapshot = structuredClone(latest.current); const key = JSON.stringify(snapshot);
    const operation = chain.current.catch(() => {}).then(async () => {
      setStatus('保存中…'); setError('');
      try { const saved = await api<{ id: string }>('/api/drafts', 'POST', { id: id.current, name: String(snapshot.name || snapshot.productName || '未完成创作'), input: snapshot }); id.current = saved.id; setLastSaved(key); setStatus('已保存草稿'); }
      catch (e) { setError((e as Error).message); setStatus('保存未成功'); throw e; }
    });
    chain.current = operation; return operation;
  }, []);
  useEffect(() => {
    if (!active || serialized === lastSaved) return;
    setStatus('有未保存修改');
    const timer = setTimeout(() => { void save().catch(() => {}); }, 650);
    return () => clearTimeout(timer);
  }, [serialized, active, lastSaved]);
  useEffect(() => {
    if (!active || serialized === lastSaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [serialized, lastSaved, active]);
  return { status, error, save };
}
