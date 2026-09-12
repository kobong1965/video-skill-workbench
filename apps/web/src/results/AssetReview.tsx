import { useState } from 'react';
import type { AssetInfo, ResultRevision, TaskInfo } from '../../../../packages/contracts';
import { api, upload, mediaUrl } from '../api';
import { useLoad, useWorkspace } from '../workspace';
import { FileDropzone } from '../uploads/FileDropzone';
import { AsyncButton, Message, Modal, kindLabel } from '../ui';

export interface Binding { id: string; name: string; kind: string; mediaId: string; parentId: string | null; batch: number | null; stale: boolean; }
export interface AssetState { bindings: Binding[]; missing: string[]; }
type RequestKind = 'person' | 'scene' | 'angle' | 'storyboard';
type Slot = { kind: RequestKind; label: string; batch?: number; parentId?: string };

function AssetPicker({ slot, task, result, done, close }: { slot: Slot; task: TaskInfo; result: ResultRevision; done: () => Promise<void>; close: () => void }) {
  const list = useLoad<AssetInfo[]>('/api/assets'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title={`选择${slot.label}`} onClose={close}><p>只使用本账号的图片。请选择与本次已确认人物、场景一致的图片；点击使用会记录这一对应关系。不会发起生图。</p><FileDropzone label="上传一张已有参考图" inputLabel="上传任务参考图" kind="image" disabled={busy} onFiles={async files => { const file = files[0]; setBusy(true); setError(''); try { const media = await upload(file); await api('/api/assets', 'POST', { mediaId: media.id, name: file.name, kind: slot.kind }); await list.refresh(); } finally { setBusy(false); } }}/>{error || list.error ? <Message error>{error || list.error}</Message> : null}<div className="asset-grid section-space">{list.data?.filter(x => x.kind === slot.kind).map(asset => <article key={asset.id} className="asset-card"><img src={mediaUrl(asset.mediaId)} alt={asset.name}/><h3>{asset.name}</h3><AsyncButton action={async () => { if (!asset.confirmed) await api(`/api/assets/${asset.id}/confirm`, 'POST', {}); await api(`/api/tasks/${task.id}/assets`, 'POST', { resultId: result.id, assetId: asset.id, batch: slot.batch, referencesConfirmed: true }); await done(); close(); }}>{asset.confirmed ? '使用这张图' : '确认并使用这张图'}</AsyncButton></article>)}</div></Modal>;
}

export function AssetReview({ task, result, state, batchCount, latest, refresh }: { task: TaskInfo; result: ResultRevision; state: AssetState; batchCount: number; latest: boolean; refresh: () => Promise<void> }) {
  const { config, notify, refreshConfig } = useWorkspace(); const [pick, setPick] = useState<Slot | null>(null); const [generate, setGenerate] = useState<Slot | null>(null); const [prompt, setPrompt] = useState(''); const [accepted, setAccepted] = useState(false);
  const currentPerson = state.bindings.find(x => x.kind === 'person' && !x.stale);
  const slots: Slot[] = [...(task.snapshot.input.generatePerson ? [{ kind: 'person' as const, label: '人物主参考' }] : []), ...(task.snapshot.input.generateScene ? [{ kind: 'scene' as const, label: '场景参考' }] : []), ...(batchCount > 1 ? Array.from({ length: batchCount }, (_, i) => ({ kind: 'storyboard' as const, label: `第 ${i + 1} 批故事面板`, batch: i + 1 })) : [])];
  const quota = config.quotas.find(x => x.kind === 'image'); const available = quota ? quota.allowance - quota.used - quota.reserved : 0;
  const enabled = config.image.enabled && config.image.configured && available > 0;
  const active = latest && result.confirmed;
  function openGenerate(slot: Slot) {
    setGenerate(slot); setAccepted(false);
    const plan = result.output.assetPlan.find(x => x.kind === slot.kind);
    const fallback = slot.kind === 'scene' ? `制作本脚本的场景参考图。${task.snapshot.input.sceneNotes}\n${result.output.globalPrompt}` : slot.kind === 'person' ? `制作本脚本成年人物的主参考图，商品穿搭严格依据当前商品图，人物外观按脚本。${task.snapshot.input.personNotes}\n${result.output.globalPrompt}` : slot.kind === 'angle' ? '依据已确认人物主参考保持人物身份，按当前商品图保持上衣款式。生成自然三分之二侧身角度的一张照片，不更换人物。' : `制作${slot.label}，每格对应这批一个镜头，所有格子保持商品和人物一致，无文字标识。`;
    setPrompt(plan?.prompt || fallback);
  }
  return <section className="panel"><div className="panel-header"><h2>参考图准备</h2><span className="tag gray">按需制作 · 每张独立确认</span></div>{!result.confirmed ? <Message>先确认脚本，再准备参考图。当前不会调用图片接口。</Message> : null}{!slots.length ? <p className="muted">本次未要求人物或场景图，且不需要跨批次故事面板，可以直接导出文字资料包。</p> : null}{state.missing.length ? <Message>完整资料包尚缺：{state.missing.join('、')}。也可以先导出文字与已有素材。</Message> : null}
    <div className="list">{slots.map(slot => { const bound = state.bindings.find(x => x.kind === slot.kind && (x.batch || undefined) === slot.batch && !x.stale); const pending = task.jobs.some(j => j.kind === 'image' && j.payload.kind === slot.kind && j.payload.batch === slot.batch && ['queued', 'running', 'unknown'].includes(j.status)); return <div className="list-row" key={`${slot.kind}-${slot.batch}`}><div><h3>{slot.label}</h3><small>{bound ? `已确认：${bound.name}` : pending ? '请求处理中或结果待确认，请先查看任务进度' : '可选已有图片，也可单张生成'}</small></div><div className="row-actions"><button disabled={!active} onClick={() => setPick(slot)}>选择已有</button><button disabled={!active || !enabled || pending} onClick={() => openGenerate(slot)}>生成一张</button></div></div>; })}</div>
    {currentPerson && task.snapshot.input.generatePerson ? <button className="section-space" disabled={!active || !enabled} onClick={() => openGenerate({ kind: 'angle', label: '人物侧身参考', parentId: currentPerson.id })}>＋ 基于已确认主图生成人物角度</button> : null}
    {slots.length && !enabled ? <small className="section-space">未启用图片接口或图片额度不足。仍可上传、选择已有图片，不必先接生图接口。</small> : null}
    <div className="asset-grid section-space">{task.assets.filter(x => x.resultId === result.id && !x.confirmed).map(asset => <article className="asset-card" key={asset.id}><img src={mediaUrl(asset.mediaId)} alt={asset.name}/><h3>{asset.name}</h3><span className="tag yellow">待你确认</span><AsyncButton disabled={!active} action={async () => { await api(`/api/assets/${asset.id}/confirm`, 'POST', {}); await refresh(); notify('图片已确认并绑定当前脚本版本'); }}>确认使用这张图</AsyncButton></article>)}{state.bindings.map(asset => <article className="asset-card" key={`${asset.id}-${asset.batch}`}><a href={mediaUrl(asset.mediaId)} target="_blank" rel="noreferrer"><img src={mediaUrl(asset.mediaId)} alt={asset.name}/></a><h3>{asset.name}</h3><small>{kindLabel[asset.kind]} · {asset.stale ? '引用已变化，需要更新' : '已确认'}</small><a href={mediaUrl(asset.mediaId)} download={asset.name}>下载独立图片 ↗</a></article>)}</div>
    {pick ? <AssetPicker slot={pick} task={task} result={result} done={refresh} close={() => setPick(null)}/> : null}
    {generate ? <Modal title={`生成${generate.label}`} onClose={() => setGenerate(null)}><div className="form-stack"><label>图片提示词<textarea aria-label="图片提示词" rows={7} value={prompt} onChange={e => setPrompt(e.target.value)}/></label><Message>将消耗 1 次图片额度，把必要的商品图和已确认参考图发送到配置的图片服务。每次只生成一张；实际费用以服务商账单为准。</Message><label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>我确认本次图片生成及可能产生的费用</label><div className="modal-footer"><button onClick={() => setGenerate(null)}>取消</button><AsyncButton className="primary" disabled={!accepted || prompt.trim().length < 5} action={async () => { await api(`/api/tasks/${task.id}/images`, 'POST', { resultId: result.id, kind: generate.kind, name: generate.label, prompt, parentId: generate.parentId, batch: generate.batch, key: crypto.randomUUID(), costAccepted: true }); setGenerate(null); await Promise.all([refresh(), refreshConfig()]); notify('单张图片任务已提交，结果出来后仍需确认'); }}>确认生成一张</AsyncButton></div></div></Modal> : null}
  </section>;
}
