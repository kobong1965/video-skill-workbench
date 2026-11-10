import { useState } from 'react';
import type { Capability, User } from '../../../../packages/contracts';
import { api, copyText } from '../api';
import { useLoad, useWorkspace } from '../workspace';
import { ExecutionSettings, ProviderPool } from './ProviderPool';
import { AsyncButton, Message } from '../ui';
import { SoftwareUpdatePanel } from './SoftwareUpdatePanel';

export function Settings() {
  return <div className="stack"><SoftwareUpdatePanel/><SettingsContent/></div>;
}

function SettingsContent() {
  const { config, user } = useWorkspace();
  if (!config.singleUserMode) return <MultiUserSettings/>;
  if (user.role !== 'admin') return <Message>请使用本机管理员账号配置接口。</Message>;
  return <div className="stack"><Message>当前为单人使用。可配置多个文字／视觉或图片接口，任务会按各自空位自动分配。</Message><ExecutionSettings/><ProviderPool kind="text"/><details className="advanced"><summary>按需配置图片接口<small>暂时只做提示词，可以不填</small></summary><div><ProviderPool kind="image"/></div></details><ModelLimits initial={config.capabilities}/></div>;
}

type Quota = { userId: string; kind: string; allowance: number; used: number; reserved: number };
function UserRow({ user, quotas, reload }: { user: User; quotas: Quota[]; reload: () => Promise<void> }) {
  const { user: me, refreshConfig, notify } = useWorkspace();
  const [text, setText] = useState(quotas.find(x => x.kind === 'text')?.allowance ?? 0); const [image, setImage] = useState(quotas.find(x => x.kind === 'image')?.allowance ?? 0);
  return <tr><td><strong>{user.displayName}</strong><small>{user.username} · {user.active ? '启用' : '停用'}</small></td><td><input aria-label={`${user.username}文字总额度`} type="number" min="0" value={text} onChange={e => setText(Number(e.target.value))}/><small>已用 {quotas.find(x => x.kind === 'text')?.used ?? 0} / 预留 {quotas.find(x => x.kind === 'text')?.reserved ?? 0}</small></td><td><input aria-label={`${user.username}图片总额度`} type="number" min="0" value={image} onChange={e => setImage(Number(e.target.value))}/><small>已用 {quotas.find(x => x.kind === 'image')?.used ?? 0} / 预留 {quotas.find(x => x.kind === 'image')?.reserved ?? 0}</small></td><td><AsyncButton action={async () => { await api(`/api/admin/quotas/${user.id}`, 'PUT', { text, image }); await Promise.all([reload(), refreshConfig()]); notify('总额度已更新，已有用量和预留未清零'); }}>保存额度</AsyncButton>{user.id !== me.id ? <AsyncButton className="text-button" action={async () => { await api(`/api/admin/users/${user.id}`, 'PATCH', { active: !user.active }); await reload(); }}>{user.active ? '停用账号' : '启用账号'}</AsyncButton> : null}</td></tr>;
}

function ModelLimits({ initial }: { initial: Record<string, Capability> }) {
  const [caps, setCaps] = useState(initial); const { notify, refreshConfig } = useWorkspace();
  const change = (model: string, patch: Partial<Capability>) => setCaps(value => ({ ...value, [model]: { ...value[model], ...patch } }));
  return <details className="advanced"><summary>视频平台时长规则<small>仅影响提示词分批，不调用视频平台</small></summary><div className="form-stack"><Message>请按你实际使用的画布核验。系统预设是项目基线，并非已核验的官方上限；旧任务会保留创建时的规则。</Message>{Object.entries(caps).map(([model, cap]) => <section key={model}><h3>{model}</h3><div className="field-grid three"><label>最短生成秒数<input type="number" min="1" max="300" value={cap.min} onChange={e => change(model, { min: Number(e.target.value) })}/></label><label>单次最长秒数<input type="number" min="1" max="300" value={cap.max} onChange={e => change(model, { max: Number(e.target.value) })}/></label><label>核验日期<input type="date" value={cap.checkedAt} onChange={e => change(model, { checkedAt: e.target.value })}/></label></div><label>规则来源<input value={cap.source} onChange={e => change(model, { source: e.target.value })}/></label><label className="check-label"><input type="checkbox" checked={cap.verified} onChange={e => change(model, { verified: e.target.checked })}/>我已核对实际画布规则</label></section>)}<div><AsyncButton action={async () => { await api('/api/admin/capabilities', 'PUT', caps); await refreshConfig(); notify('分批规则已保存，仅用于新创作'); }}>保存时长规则</AsyncButton></div></div></details>;
}

function MultiUserSettings() {
  const { user, config, notify } = useWorkspace(); const users = useLoad<User[]>('/api/admin/users'); const quotas = useLoad<Quota[]>('/api/admin/quotas'); const [token, setToken] = useState('');
  if (user.role !== 'admin') return <Message>接口和额度由管理员统一设置，请联系管理员。你的商品、脚本和任务仍只属于你的账号。</Message>;
  if (users.data === null || quotas.data === null) return <Message error={Boolean(users.error || quotas.error)}>{users.error || quotas.error || '正在读取账号额度…'}{users.error || quotas.error ? <AsyncButton action={async () => { await Promise.all([users.refresh(), quotas.refresh()]); }}>重新读取</AsyncButton> : null}</Message>;
  return <div className="stack"><Message>首次使用配置文字／视觉接口和文字额度。可添加多个接口自动分配，图片接口按需配置。</Message><ExecutionSettings/><ProviderPool kind="text"/><details className="advanced"><summary>按需配置图片接口<small>暂时只做提示词，可以不填</small></summary><div><ProviderPool kind="image"/></div></details><section className="panel"><div className="panel-header"><h2>账号与使用额度</h2><AsyncButton action={async () => { const result = await api<{ token: string }>('/api/admin/invitations', 'POST', { days: 7 }); setToken(result.token); }}>创建 7 天邀请码</AsyncButton></div><small>额度是累计请求次数上限，不是人民币余额。修改不会清空历史用量；响应未知的请求保留预算。</small>{token ? <Message>单次邀请码：<code>{token}</code><AsyncButton className="text-button" action={async () => { await copyText(token); notify('邀请码已复制'); }}>复制邀请码</AsyncButton><small>仅交给获准使用的人。此版仅本机访问，远程邀请试用属于后续部署阶段。</small></Message> : null}{users.error || quotas.error ? <Message error>{users.error || quotas.error}</Message> : null}<div className="table-wrap"><table><thead><tr><th>账号</th><th>文字总额度</th><th>图片总额度</th><th>操作</th></tr></thead><tbody>{users.data?.map(item => <UserRow key={`${item.id}-${quotas.data ? 'loaded' : 'loading'}`} user={item} quotas={quotas.data?.filter(q => q.userId === item.id) || []} reload={async () => { await Promise.all([users.refresh(), quotas.refresh()]); }}/>)}</tbody></table></div></section><ModelLimits initial={config.capabilities}/></div>;
}
