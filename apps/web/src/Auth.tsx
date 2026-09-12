import { useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { api, setCsrf } from './api';
import type { User } from '../../../packages/contracts';
import { Message, Icon } from './ui';

export function Auth({ needsSetup, onLogin }: { needsSetup: boolean; onLogin: (user: User) => void }) {
  const [join, setJoin] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [displayName, setDisplayName] = useState(''); const [token, setToken] = useState('');
  return <main className="auth-shell"><section className="auth-story"><BrandLogo/><p className="eyebrow">视频 Skill 工作台</p><h1>好脚本，<br/>留给下一件商品。</h1><p>把验证过的拍法保存下来。<br/>换一件商品，开始下一次创作。</p><div className="auth-steps"><span>上传商品</span><Icon name="arrow"/><span>选择脚本</span><Icon name="arrow"/><span>拿到提示词</span></div></section><section className="auth-card"><h2>{needsSetup ? '开通你的工作台' : join ? '通过邀请加入' : '欢迎回来'}</h2><p className="muted">{needsSetup ? '首次设置管理员账号，资料保存在本机。' : '个人商品、参考图和生成记录独立保存。'}</p><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const result = await api<{ user: User; csrf: string }>(needsSetup ? '/api/auth/setup' : join ? '/api/auth/join' : '/api/auth/login', 'POST', { username, password, displayName, token, setupKey: token }); setCsrf(result.csrf); onLogin(result.user); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
    {needsSetup || join ? <label>{needsSetup ? '本机安装码' : '邀请码'}<input value={token} onChange={e => setToken(e.target.value)} required autoComplete="off"/>{needsSetup ? <small>在本机数据文件夹中的“本机安装码.txt”查看。</small> : null}</label> : null}
    {needsSetup || join ? <label>怎么称呼你<input value={displayName} onChange={e => setDisplayName(e.target.value)} required maxLength={50} autoComplete="nickname"/></label> : null}
    <label>登录账号<input value={username} onChange={e => setUsername(e.target.value)} required pattern="[a-zA-Z0-9_-]{3,40}" autoComplete="username" placeholder="3–40 位字母、数字、下划线"/></label>
    <label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} maxLength={200} required autoComplete={needsSetup || join ? 'new-password' : 'current-password'} placeholder="至少 10 位"/></label>
    {error ? <Message error>{error}</Message> : null}<button className="primary full-width" disabled={busy}>{busy ? '正在处理…' : needsSetup ? '创建管理员账号' : join ? '加入工作台' : '进入工作台'}<Icon name="arrow"/></button>
  </form>{!needsSetup ? <button className="text-button" onClick={() => { setJoin(!join); setError(''); }}>{join ? '已有账号，返回登录' : '我有邀请码'}</button> : null}<p className="fine-print">不公开注册 · 不会自动调用付费接口</p></section></main>;
}
