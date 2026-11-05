import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useWorkspace } from '../workspace';
import { AsyncButton, Message } from '../ui';
import { freshProvider, providerDraft, providerPayload, type ProviderDraft, type ProviderKind } from './provider-pool';
import './settings.css';

export function ProviderPool({ kind }: { kind: ProviderKind }) {
  const { config, refreshConfig, notify } = useWorkspace();
  const singleUser = config.singleUserMode === true;
  const source = config.providerPools?.[kind];
  const legacy = config[kind];
  const initial = () => (source?.length ? source : [legacy]).map((item, index) => providerDraft(item, kind, index, singleUser));
  const [providers, setProviders] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const title = kind === 'text' ? '文字／视觉接口' : '图片接口';
  const shortTitle = kind === 'text' ? '文字接口' : '图片接口';
  useEffect(() => {
    if (dirty) return;
    if (source && !source.length) {
      setProviders(items => items.filter(item => !item.enabled && !item.hasKey && !item.baseUrl && !item.model && !item.apiKey));
    } else setProviders((source ?? [legacy]).map((item, index) => providerDraft(item, kind, index, singleUser)));
  }, [source, legacy, kind, singleUser, dirty]);
  function change(id: string, patch: Partial<ProviderDraft>) {
    setProviders(items => items.map(item => item.id === id ? { ...item, ...patch } : item)); setDirty(true);
  }
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      await api(`/api/admin/provider-pools/${kind}`, 'PUT', { providers: providers.map(item => providerPayload(item, kind, singleUser)) });
      setProviders(items => items.map(item => ({ ...item, apiKey: '', hasKey: item.hasKey || Boolean(item.apiKey) })));
      // Refresh before dropping the draft flag, so old config cannot replace a just-saved pool.
      await refreshConfig(); setDirty(false);
      notify(`${shortTitle}池已保存，后续任务将自动分配`);
    } finally { savingRef.current = false; setSaving(false); }
  }
  return <div className="provider-pool stack">
    <div className="provider-pool-heading"><div><h2>{title}池</h2><p className="muted">{kind === 'text' ? '用于看商品图、适配脚本和生成中文提示词。' : '按需生成人物、场景和故事面板参考图。'}新任务自动分配到已启用且有空位的接口。</p></div><button type="button" disabled={saving || providers.length >= 16} onClick={() => { setProviders(items => items.length === 1 && !items[0]!.hasKey && !items[0]!.baseUrl && !items[0]!.model && !items[0]!.apiKey ? [freshProvider(kind, 1, singleUser)] : [...items, freshProvider(kind, items.length + 1, singleUser)]); setDirty(true); }}>添加{shortTitle}</button></div>
    {providers.map((item, index) => <section className="panel provider-node" aria-label={`${title}配置 ${index + 1}`} key={item.id}>
      <div className="panel-header"><h2>{index === 0 ? title : `${title} · ${item.name || '新接口'}`}</h2><div className="provider-node-state"><span className="tag gray">{item.hasKey ? '密钥已保存' : '尚未保存密钥'}</span><span className="muted">处理中 {item.activeJobs} / {item.maxConcurrency}</span><button type="button" className="text-button" disabled={saving} aria-label={`移除接口：${item.name}`} onClick={() => { setProviders(items => items.filter(provider => provider.id !== item.id)); setDirty(true); }}>移除</button></div></div>
      <fieldset className="provider-fields form-stack" disabled={saving}>
        <label className="check-label"><input type="checkbox" checked={item.enabled} onChange={event => change(item.id, { enabled: event.target.checked })}/>启用{title}</label>
        <div className="field-grid"><label>接口名称<input maxLength={60} value={item.name} onChange={event => change(item.id, { name: event.target.value })}/></label><label>每个接口同时处理上限<input type="number" min="1" max="32" value={item.maxConcurrency} onChange={event => change(item.id, { maxConcurrency: Number(event.target.value) })}/></label></div>
        <div className="field-grid"><label>接口地址<input type="url" placeholder="https://服务地址/v1" value={item.baseUrl} onChange={event => change(item.id, { baseUrl: event.target.value })}/></label><label>模型名称<input value={item.model} placeholder="填写服务商文档中的模型名" onChange={event => change(item.id, { model: event.target.value })}/></label></div>
        <label>接口密钥<input type="password" autoComplete="new-password" value={item.apiKey} placeholder={item.hasKey ? '已保存。留空不修改密钥' : '仅保存到本机服务端，不显示已有密钥'} onChange={event => change(item.id, { apiKey: event.target.value })}/></label>
        <div className="checkbox-row">{kind === 'text' ? <>{!singleUser ? <label className="check-label"><input type="checkbox" checked={item.vision} onChange={event => change(item.id, { vision: event.target.checked })}/>已确认支持商品图片输入</label> : null}<label className="check-label"><input type="checkbox" checked={item.jsonMode} onChange={event => change(item.id, { jsonMode: event.target.checked })}/>支持 JSON 输出模式</label></> : <><label className="check-label"><input type="checkbox" checked={item.references} onChange={event => change(item.id, { references: event.target.checked })}/>支持参考图编辑</label><label className="check-label"><input type="checkbox" checked={item.multiReference} onChange={event => change(item.id, { multiReference: event.target.checked })}/>支持多张参考图</label></>}</div>
        <details className="advanced"><summary>接口高级选项</summary><div className="form-stack"><label>超时时间（秒）<input type="number" min="0" max="3600" value={item.timeoutSeconds} onChange={event => change(item.id, { timeoutSeconds: Number(event.target.value) })}/><small>设为 0 表示由接口完成后返回，软件不主动中断；最多可设 3600 秒。</small></label>{kind === 'image' ? <label>允许下载图片的域名（逗号分隔）<input value={item.outputHosts} onChange={event => change(item.id, { outputHosts: event.target.value })} placeholder="仅填写服务商实际使用的图片域名"/></label> : null}<small>当前支持兼容 Chat Completions / Images 的接口格式。保存配置不会发起生成请求。</small></div></details>
        <div><AsyncButton className="primary" disabled={saving} action={save}>保存{title}</AsyncButton></div>
      </fieldset>
    </section>)}
    {!providers.length ? <Message>尚无{shortTitle}。添加接口后即可启用自动分配。</Message> : null}
    <div className="provider-pool-footer"><AsyncButton className="primary" disabled={saving || !dirty} action={save}>保存{shortTitle}池</AsyncButton><small>{dirty ? '有未保存的修改；添加、移除和修改将在保存接口池后生效。' : '保存会一并保存本列表的全部接口。已有密钥留空即可保留。'}</small></div>
  </div>;
}

export function ExecutionSettings() {
  const { config, refreshConfig, notify } = useWorkspace();
  const initial = config.execution?.maxConcurrentJobs ?? 8;
  const [limit, setLimit] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setLimit(initial); }, [initial, dirty]);
  return <section className="panel execution-settings"><h2>并行处理</h2><p className="muted">可以连续提交多个计划，后台按空位自动分配接口并同时处理。</p><div className="execution-settings-row"><label>同时处理上限<input aria-label="同时处理上限" aria-describedby="execution-limit-help" type="number" min="1" max="32" value={limit} onChange={event => { setLimit(Number(event.target.value)); setDirty(true); }}/><small id="execution-limit-help">文字和图片生成共享此上限，每个接口还有自己的上限。</small></label><AsyncButton disabled={!dirty || !Number.isInteger(limit) || limit < 1 || limit > 32} action={async () => { await api('/api/admin/execution', 'PUT', { maxConcurrentJobs: limit }); await refreshConfig(); setDirty(false); notify('并行处理上限已保存'); }}>保存并行设置</AsyncButton></div></section>;
}
