import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { User, Capability, CreationInput } from '../../../packages/contracts';
export interface PublicProvider { id?: string; name?: string; maxConcurrency?: number; activeJobs?: number; enabled: boolean; configured: boolean; hasKey: boolean; baseUrl?: string; model?: string; protocol?: string; vision?: boolean; references?: boolean; multiReference?: boolean; timeoutSeconds?: number; outputHosts?: string[]; jsonMode?: boolean; }
export interface Config { text: PublicProvider; image: PublicProvider; providerPools?: { text: PublicProvider[]; image: PublicProvider[] }; execution?: { maxConcurrentJobs: number }; capabilities: Record<string, Capability>; quotas: { kind: string; allowance: number; used: number; reserved: number }[]; testMode?: boolean; singleUserMode?: boolean; }
export type CreationStart = Partial<CreationInput> & { _draftId?: string };
export interface Workspace { user: User; config: Config; preferences: Record<string, string>; refreshConfig: () => Promise<void>; notify: (message: string) => void; navigate: (path: string) => void; start: (input?: CreationStart) => void; registerDraftSaver: (save: (() => Promise<void>) | null) => void; registerNavigationGuard: (owner: symbol, guard: (() => boolean) | null) => void; }
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error('缺少工作区'); return value; }
export function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setError(''); try { setData(await api<T>(url)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }, [url]);
  useEffect(() => { let active = true; setLoading(true); setData(null); setError(''); void api<T>(url).then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [url]);
  return { data, error, loading, refresh, setData };
}
