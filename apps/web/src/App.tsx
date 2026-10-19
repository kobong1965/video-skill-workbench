import { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react';
import { api, setCsrf } from './api';
import { Auth } from './Auth';
import { BrandLogo } from './BrandLogo';
import { WorkspaceContext, type Config, type CreationStart } from './workspace';
import { Icon, Message, Modal } from './ui';
import type { CreationInput, User } from '../../../packages/contracts';
import { Creation } from './create/Creation';
import { useFileNavigationGuard } from './uploads/FileDropzone';
import { TaskBoard } from './tasks/TaskBoard';
const SkillLibrary = lazy(() => import('./skills/SkillLibrary').then(module => ({ default: module.SkillLibrary })));
const History = lazy(() => import('./history/History').then(module => ({ default: module.History })));
const Settings = lazy(() => import('./admin/Settings').then(module => ({ default: module.Settings })));
const AssetLibrary = lazy(() => import('./assets/AssetLibrary').then(module => ({ default: module.AssetLibrary })));
const TaskResult = lazy(() => import('./results/TaskResult').then(module => ({ default: module.TaskResult })));
type NavigationAction = () => void | Promise<void>;
const navigationItems = [
  { path: 'create', name: '创作工作台', label: '创作', icon: 'create' },
  { path: 'library', name: '脚本库', label: '脚本', icon: 'library' },
  { path: 'history', name: '生成记录', label: '记录', icon: 'history' },
  { path: 'assets', name: '参考图库', label: '素材', icon: 'image' },
];
const pageNames: Record<string, { name: string; label: string }> = {
  create: { name: '创作工作台', label: '工作台' }, library: { name: '脚本库', label: '脚本库' },
  history: { name: '生成记录', label: '记录' }, assets: { name: '参考图库', label: '素材' },
  settings: { name: '管理设置', label: '设置' },
};

export function App() {
  useFileNavigationGuard();
  const [user, setUser] = useState<User | null>(null); const [needsSetup, setNeedsSetup] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null); const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [route, setRoute] = useState(location.hash.slice(1) || 'create'); const [toast, setToast] = useState('');
  const [initial, setInitial] = useState<CreationStart>({}); const [creationKey, setCreationKey] = useState(0);
  const routeRef = useRef(route);
  const navigationGuard = useRef<{ owner: symbol; blocked: () => boolean } | null>(null);
  const navigationBusy = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ action: NavigationAction } | null>(null);
  const draftSaver = useRef<(() => Promise<void>) | null>(null);
  const registerDraftSaver = useCallback((save: (() => Promise<void>) | null) => { draftSaver.current = save; }, []);
  const registerNavigationGuard = useCallback((owner: symbol, guard: (() => boolean) | null) => {
    if (guard) navigationGuard.current = { owner, blocked: guard };
    else if (navigationGuard.current?.owner === owner) navigationGuard.current = null;
  }, []);
  const performNavigation = useCallback(async (action: NavigationAction) => {
    if (navigationBusy.current) return;
    navigationBusy.current = true;
    try { await action(); } catch (e) { setToast((e as Error).message); }
    finally { navigationBusy.current = false; }
  }, []);
  const requestNavigation = useCallback((action: NavigationAction) => {
    if (navigationBusy.current) return;
    if (navigationGuard.current?.blocked()) setPendingNavigation({ action });
    else void performNavigation(action);
  }, [performNavigation]);
  const commitRoute = useCallback((path: string, replace = false) => {
    if (location.hash !== `#${path}`) history[replace ? 'replaceState' : 'pushState'](null, '', `#${path}`);
    routeRef.current = path; setRoute(path);
  }, []);
  useEffect(() => {
    const changed = () => {
      const path = location.hash.slice(1) || 'create';
      if (path === routeRef.current) return;
      if (navigationBusy.current || navigationGuard.current?.blocked()) {
        history.replaceState(null, '', `#${routeRef.current}`);
        if (!navigationBusy.current) requestNavigation(() => commitRoute(path, true));
      } else commitRoute(path, true);
    };
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, [commitRoute, requestNavigation]);
  useEffect(() => { void api<{ needsSetup: boolean; hasSession: boolean }>('/api/auth/state').then(async state => {
    setNeedsSetup(state.needsSetup);
    if (state.hasSession) { const profile = await api<{ user: User; csrf: string; preferences: Record<string, string> }>('/api/me'); setCsrf(profile.csrf); setUser(profile.user); setPreferences(profile.preferences); }
  }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const refreshConfig = useCallback(async () => { setConfig(await api<Config>('/api/config')); }, []);
  useEffect(() => { if (user) void refreshConfig().catch(e => setError(e.message)); }, [user, refreshConfig]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  const navigate = useCallback((path: string) => { if (path !== routeRef.current) requestNavigation(() => commitRoute(path)); }, [commitRoute, requestNavigation]);
  function start(input: CreationStart = {}) { requestNavigation(async () => { try { await draftSaver.current?.(); setInitial(input); setCreationKey(key => key + 1); commitRoute('create'); } catch { setToast('当前草稿保存失败，请重试保存后再新建，避免丢失输入'); } }); }
  if (loading) return <div className="loading-page" role="status">正在打开工作台…</div>;
  if (error && !user) return <div className="loading-page"><Message error>{error}</Message><button onClick={() => location.reload()}>重新连接</button></div>;
  if (!user) return <Auth needsSetup={needsSetup} onLogin={value => { void api<{ preferences: Record<string, string> }>('/api/me').then(profile => { setPreferences(profile.preferences); setUser(value); setNeedsSetup(false); navigate('create'); }).catch(e => setError(e.message)); }}/>;
  if (!config) return <div className="loading-page"><Message error={Boolean(error)}>{error || '正在读取工作区…'}</Message><button onClick={() => void refreshConfig().catch(e => setError(e.message))}>重新读取</button></div>;
  const page = pageNames[route] ?? { name: '提示词', label: '提示词' };
  return <WorkspaceContext.Provider value={{ user, config, preferences, refreshConfig, notify: setToast, navigate, start, registerDraftSaver, registerNavigationGuard }}><div className="app-shell"><aside className="sidebar"><a href="#create" className="brand"><BrandLogo/><span>视频 Skill<small>工作台</small></span></a><nav aria-label="工作台导航">{navigationItems.map(item => <a key={item.path} href={`#${item.path}`} title={item.name} aria-label={item.name} aria-current={route === item.path ? 'page' : undefined} className={route === item.path ? 'active' : ''}><Icon name={item.icon}/><span>{item.label}</span></a>)}</nav><div className="sidebar-bottom">{user.role === 'admin' ? <a href="#settings" aria-label="管理设置" title="管理设置" aria-current={route === 'settings' ? 'page' : undefined} className={route === 'settings' ? 'active' : ''}><Icon name="settings"/><span>设置</span></a> : null}<div className="profile"><span className="avatar">{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '成员'}</small></div><button className="logout" title="退出登录" aria-label="退出登录" onClick={() => requestNavigation(async () => { await api('/api/auth/logout', 'POST', {}); navigationGuard.current = null; setUser(null); setConfig(null); })}><Icon name="logout"/></button></div></div></aside><main className="workspace-main">
    {config.testMode ? <Message>自动化测试环境 · 展示的测试结果不代表真实 AI 生成</Message> : null}
    <div className="page-header"><h1 aria-label={page.name}>{page.label}</h1></div>
    <div className={`workspace-with-tasks ${route !== 'create' ? 'without-tasks' : ''}`}><div className="workspace-content">
    <div hidden={route !== 'create'}><Creation key={creationKey} initial={initial}/></div>
    <Suspense fallback={<Message>正在打开页面…</Message>}>
      {route === 'library' ? <SkillLibrary/> : route === 'history' ? <History/> : route === 'assets' ? <AssetLibrary/> : route === 'settings' ? <Settings/> : route.startsWith('task/') ? <TaskResult key={route} id={route.slice(5)}/> : route !== 'create' ? <Message>没有找到这个页面，请从左侧导航重新打开。</Message> : null}
    </Suspense>
    </div>{route === 'create' ? <TaskBoard route={route}/> : null}</div>
  </main></div>{pendingNavigation ? <Modal title="未保存的修改" onClose={() => setPendingNavigation(null)}><p>当前提示词有未保存的修改。</p><div className="modal-footer"><button onClick={() => setPendingNavigation(null)}>继续编辑</button><button className="primary" onClick={() => { const action = pendingNavigation.action; setPendingNavigation(null); void performNavigation(action); }}>放弃修改并继续</button></div></Modal> : null}{toast ? <div className="toast" role="status"><Icon name="check"/>{toast}</div> : null}</WorkspaceContext.Provider>;
}
