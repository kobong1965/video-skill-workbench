import { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react';
import { api, setCsrf } from './api';
import { Auth } from './Auth';
import { BrandLogo } from './BrandLogo';
import { WorkspaceContext, type Config, type CreationStart } from './workspace';
import { Icon, Message } from './ui';
import type { CreationInput, User } from '../../../packages/contracts';
import { Creation } from './create/Creation';
import { useFileNavigationGuard } from './uploads/FileDropzone';
const SkillLibrary = lazy(() => import('./skills/SkillLibrary').then(module => ({ default: module.SkillLibrary })));
const History = lazy(() => import('./history/History').then(module => ({ default: module.History })));
const Settings = lazy(() => import('./admin/Settings').then(module => ({ default: module.Settings })));
const AssetLibrary = lazy(() => import('./assets/AssetLibrary').then(module => ({ default: module.AssetLibrary })));
const TaskResult = lazy(() => import('./results/TaskResult').then(module => ({ default: module.TaskResult })));

export function App() {
  useFileNavigationGuard();
  const [user, setUser] = useState<User | null>(null); const [needsSetup, setNeedsSetup] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null); const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [route, setRoute] = useState(location.hash.slice(1) || 'create'); const [toast, setToast] = useState('');
  const [initial, setInitial] = useState<CreationStart>({}); const [creationKey, setCreationKey] = useState(0);
  const draftSaver = useRef<(() => Promise<void>) | null>(null);
  const registerDraftSaver = useCallback((save: (() => Promise<void>) | null) => { draftSaver.current = save; }, []);
  useEffect(() => { const changed = () => setRoute(location.hash.slice(1) || 'create'); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => { void api<{ needsSetup: boolean; hasSession: boolean }>('/api/auth/state').then(async state => {
    setNeedsSetup(state.needsSetup);
    if (state.hasSession) { const profile = await api<{ user: User; csrf: string; preferences: Record<string, string> }>('/api/me'); setCsrf(profile.csrf); setUser(profile.user); setPreferences(profile.preferences); }
  }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const refreshConfig = useCallback(async () => { setConfig(await api<Config>('/api/config')); }, []);
  useEffect(() => { if (user) void refreshConfig().catch(e => setError(e.message)); }, [user, refreshConfig]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  const navigate = useCallback((path: string) => { location.hash = path; }, []);
  function start(input: CreationStart = {}) { void (async () => { try { await draftSaver.current?.(); setInitial(input); setCreationKey(key => key + 1); navigate('create'); } catch { setToast('当前草稿保存失败，请重试保存后再新建，避免丢失输入'); } })(); }
  if (loading) return <div className="loading-page" role="status">正在打开工作台…</div>;
  if (error && !user) return <div className="loading-page"><Message error>{error}</Message><button onClick={() => location.reload()}>重新连接</button></div>;
  if (!user) return <Auth needsSetup={needsSetup} onLogin={value => { void api<{ preferences: Record<string, string> }>('/api/me').then(profile => { setPreferences(profile.preferences); setUser(value); setNeedsSetup(false); navigate('create'); }).catch(e => setError(e.message)); }}/>;
  if (!config) return <div className="loading-page"><Message error={Boolean(error)}>{error || '正在读取工作区…'}</Message><button onClick={() => void refreshConfig().catch(e => setError(e.message))}>重新读取</button></div>;
  const nav = [{ path: 'create', name: '创作工作台', icon: 'create' }, { path: 'library', name: '脚本库', icon: 'library' }, { path: 'history', name: '生成记录', icon: 'history' }, { path: 'assets', name: '参考图库', icon: 'image' }];
  return <WorkspaceContext.Provider value={{ user, config, preferences, refreshConfig, notify: setToast, navigate, start, registerDraftSaver }}><div className="app-shell"><aside className="sidebar"><a href="#create" className="brand"><BrandLogo/><span>视频 Skill<small>工作台</small></span></a><nav aria-label="工作台导航">{nav.map(item => <a key={item.path} href={`#${item.path}`} title={item.name} className={route === item.path ? 'active' : ''}><Icon name={item.icon}/><span>{item.name}</span></a>)}</nav><div className="sidebar-note"><span className="note-icon">↗</span><strong>从一个好脚本开始</strong><p>保存经验，替换商品。<br/>一步一步，把创作变简单。</p></div><div className="sidebar-bottom">{user.role === 'admin' ? <a href="#settings" className={route === 'settings' ? 'active' : ''}><Icon name="settings"/><span>管理设置</span></a> : null}<div className="profile"><span className="avatar">{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '成员'}</small></div><button className="logout" title="退出登录" aria-label="退出登录" onClick={async () => { await api('/api/auth/logout', 'POST', {}); setUser(null); setConfig(null); }}>↪</button></div></div></aside><main className="workspace-main">
    {config.testMode ? <Message>自动化测试环境 · 展示的测试结果不代表真实 AI 生成</Message> : null}
    <div className="page-header"><div><p className="eyebrow">YOUR CREATIVE WORKSPACE</p><h1>{route === 'create' ? '创作工作台' : route === 'library' ? '脚本库' : route === 'history' ? '生成记录' : route === 'assets' ? '参考图库' : route === 'settings' ? '管理设置' : '这次怎么拍'}</h1><p className="muted">{route === 'create' ? '给商品选一套好脚本，开始下一次创作。' : '资料与版本会保存下来，随时可以继续。'}</p></div><button onClick={() => start()}>＋ 新建创作</button></div>
    <div hidden={route !== 'create'}><Creation key={creationKey} initial={initial}/></div>
    <Suspense fallback={<Message>正在打开页面…</Message>}>
      {route === 'library' ? <SkillLibrary/> : route === 'history' ? <History/> : route === 'assets' ? <AssetLibrary/> : route === 'settings' ? <Settings/> : route.startsWith('task/') ? <TaskResult key={route} id={route.slice(5)}/> : route !== 'create' ? <Message>没有找到这个页面，请从左侧导航重新打开。</Message> : null}
    </Suspense>
  </main></div>{toast ? <div className="toast" role="status"><Icon name="check"/>{toast}</div> : null}</WorkspaceContext.Provider>;
}
