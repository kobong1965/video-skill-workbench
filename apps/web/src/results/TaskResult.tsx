import { lazy, Suspense, useEffect, useState } from 'react';
import type { JobInfo, TaskInfo } from '../../../../packages/contracts';
import { api } from '../api';
import { useLoad, useWorkspace } from '../workspace';
import { AsyncButton, ControlHint, Icon, Message, Modal, statusLabel } from '../ui';
import { PromptEditor } from './PromptEditor';
import { assignedProviderLabel } from '../tasks/task-routing';
const CanvasImportModal = lazy(() => import('../canvas/CanvasImportModal').then(module => ({ default: module.CanvasImportModal })));

function JobStatus({ task, refresh }: { task: TaskInfo; refresh: () => Promise<void> }) {
  const { config, refreshConfig, notify } = useWorkspace(); const singleUser = config.singleUserMode === true; const [retry, setRetry] = useState<JobInfo | null>(null); const [accepted, setAccepted] = useState(false); const [risk, setRisk] = useState(false); const [raw, setRaw] = useState<string | null>(null); const [rawImage, setRawImage] = useState(false);
  const issues = task.jobs.filter((job, index) => {
    if (job.status === 'succeeded') return false;
    if (!singleUser) return true;
    if (job.kind === 'text' && task.results.length > 0) return false;
    return !task.jobs.slice(index + 1).some(later => later.kind === job.kind && ['queued', 'running', 'succeeded'].includes(later.status) && (job.kind === 'text' || (later.payload.resultId === job.payload.resultId && later.payload.kind === job.payload.kind && (later.payload.batch ?? null) === (job.payload.batch ?? null) && (job.payload.kind !== 'angle' || later.payload.name === job.payload.name))));
  });
  const riskRequired = retry?.status === 'unknown' || (retry?.kind === 'image' && retry.status === 'invalid');
  return <>{issues.map(job => <div className="message" key={job.id}><strong>{job.kind === 'text' ? '提示词' : String(job.payload.name || '参考图')} · {statusLabel[job.status] || job.status}</strong><div>{job.error || (job.status === 'queued' ? '任务已保存，等待后台处理。关闭页面不会取消。' : job.status === 'running' ? '后台正在处理，已有内容会继续保留。' : '')}</div>{job.provider ? <small className="job-provider-detail">使用接口：{assignedProviderLabel(job)}</small> : job.status === 'queued' ? <small className="job-provider-detail">等待可用接口自动分配</small> : null}<div className="inline">{['failed', 'invalid', 'unknown'].includes(job.status) ? singleUser ? <AsyncButton action={async () => { await api(`/api/jobs/${job.id}/retry`, 'POST', { costAccepted: true, riskAccepted: true }); await Promise.all([refresh(), refreshConfig()]); notify('已重试所选步骤'); }}>重试这一步</AsyncButton> : <button disabled={job.attempts >= 3} onClick={() => { setRetry(job); setAccepted(false); setRisk(false); }}>重试这一步（{job.attempts}/3）</button> : null}{job.status === 'invalid' ? <AsyncButton action={async () => { setRawImage(job.kind === 'image'); setRaw((await api<{ text: string }>(`/api/jobs/${job.id}/raw`)).text); }}>{job.kind === 'image' ? '查看上游返回信息' : '查看并修正原始结果'}</AsyncButton> : null}</div>{job.status === 'unknown' ? <small>{singleUser ? '响应中断，已保留当前记录。可以直接点击重试这一步。' : '尚不能确认上游是否完成或计费，系统不会自动重新请求。请先核对服务商记录。'}</small> : null}</div>)}
    {retry ? <Modal title="确认重试这一步" onClose={() => setRetry(null)}><div className="form-stack"><Message>将再次使用 1 次{retry.kind === 'text' ? '文字' : '图片'}额度。仅重试所选步骤，已有结果与图片保留。</Message><label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>我确认重试并承担本次费用</label>{riskRequired ? <label className="check-label"><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)}/>我已核对上游，接受再次生成可能导致的重复费用</label> : null}<AsyncButton className="primary" disabled={!accepted || (riskRequired && !risk)} action={async () => { await api(`/api/jobs/${retry.id}/retry`, 'POST', { costAccepted: true, riskAccepted: risk }); setRetry(null); await Promise.all([refresh(), refreshConfig()]); notify('已重试所选步骤'); }}>确认重试</AsyncButton></div></Modal> : null}
    {raw !== null ? <Modal title="原始结果（仅本账号可见）" onClose={() => setRaw(null)}>{rawImage ? <><Message>{singleUser ? '这是图片接口的返回信息，可检查后直接重试生成。' : '这是上游图片响应，不是脚本文本。请核对服务商已生成的图片；重新生成会再次使用额度。'}</Message><pre className="source-text">{raw}</pre></> : <><p>输出结构不符时不会伪造成功。可在这里修正为符合结构的结果后保存；保存修改不会调用生成接口。</p><label>结构化结果<textarea aria-label="修正原始结果" rows={16} value={raw} onChange={e => setRaw(e.target.value)}/></label><div className="modal-footer"><AsyncButton action={async () => { let output: unknown; try { output = JSON.parse(raw); } catch { throw new Error('内容不是有效 JSON，请先修正结构'); } await api(`/api/tasks/${task.id}/results`, 'POST', { output }); setRaw(null); await refresh(); notify('修正内容已保存为新版本，请检查并确认'); }}>保存修正新版本</AsyncButton></div></>}</Modal> : null}
  </>;
}

export function TaskResult({ id }: { id: string }) {
  const { config, notify, start, refreshConfig } = useWorkspace(); const singleUser = config.singleUserMode === true; const task = useLoad<TaskInfo>(`/api/tasks/${id}`); const [version, setVersion] = useState(''); const [generate, setGenerate] = useState(false);
  const [canvas, setCanvas] = useState(false);
  const [dirtyResultId, setDirtyResultId] = useState<string | null>(null);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const running = task.data?.jobs.some(x => ['queued', 'running'].includes(x.status));
  useEffect(() => { if (!running) return; const timer = setInterval(() => { void task.refresh(); }, 2500); return () => clearInterval(timer); }, [running, task.refresh]);
  useEffect(() => { if (!running && task.data) void refreshConfig(); }, [running]);
  if (!task.data) return <Message error={Boolean(task.error)}>{task.error || '正在读取创作记录…'}{task.error ? <button onClick={() => void task.refresh()}>重新读取</button> : null}</Message>;
  const result = task.data.results.find(x => x.id === dirtyResultId) || task.data.results.find(x => x.id === version) || task.data.results[0];
  const dirty = Boolean(result && dirtyResultId === result.id);
  const routes = (['text', 'image'] as const).map(kind => task.data!.jobs.findLast(job => job.kind === kind)).filter(job => job && (job.provider || job.status === 'queued' || job.status === 'running'));
  function selectVersion(value: string) {
    if (value === result?.id) return;
    if (dirty) setPendingVersion(value);
    else { setVersion(value); setCanvas(false); }
  }
  async function reload() {
    const updated = await api<TaskInfo>(`/api/tasks/${id}`);
    task.setData(updated);
    setVersion('');
  }
  async function submit() { await api(`/api/tasks/${id}/generate`, 'POST', { key: crypto.randomUUID(), costAccepted: true }); setGenerate(false); await reload(); notify('任务已提交'); }
  return <>
    <div className="toolbar result-toolbar"><div className="result-heading"><h2>{task.data.name}</h2><div className="tags"><span className="tag blue">{result ? '提示词已生成' : statusLabel[task.data.status] || task.data.status}</span>{task.data.snapshot.skills.map(x => <span className="tag gray" key={x.versionId}>{x.name} · {Math.round(x.duration * 100) / 100}s</span>)}</div>{routes.length ? <div className="task-provider-summary" aria-label="接口分配">{routes.map(job => <span key={job!.id}>{job!.kind === 'text' ? '文字' : '图片'}：{assignedProviderLabel(job) || '等待自动分配'}</span>)}</div> : null}</div>
      <div className="result-toolbar-actions">
        <ControlHint label="刷新进度"><button aria-label="刷新进度" title="刷新进度" onClick={() => void task.refresh()}><Icon name="refresh"/><span>刷新</span></button></ControlHint>
        <ControlHint label="另存新创作"><button aria-label="另存新创作" title="另存新创作" onClick={() => start({ ...task.data!.snapshot.input, parentId: id, name: `${task.data!.name} · 新创作` })}><Icon name="plus"/><span>新建</span></button></ControlHint>
        {result ? <ControlHint label={dirty ? '先保存修改，再导入画布' : '导入 LibTV 画布'}><button className="primary" aria-label="导入画布" disabled={dirty} title={dirty ? '先保存修改，再导入画布' : '导入 LibTV 画布'} onClick={() => { if (!dirty) setCanvas(true); }}><Icon name="import"/><span>导入</span></button></ControlHint> : null}
      </div>
    </div>
    {task.error ? <Message error>{task.error}</Message> : null}<JobStatus task={task.data} refresh={reload}/>
    {!result && !task.data.jobs.length ? <section className="panel"><h2>输入已经保存，可以继续生成</h2><p>{singleUser ? '本次尚未提交到文字接口，点击即可继续生成。' : '本次尚未提交到文字接口。确认后才会使用额度。'}</p>{singleUser ? <AsyncButton className="primary" action={submit}>继续生成提示词</AsyncButton> : <button className="primary" onClick={() => setGenerate(true)}>继续生成提示词</button>}</section> : null}
    {result ? <><label className="result-version"><span>版本</span><select aria-label="查看保存版本" value={result.id} onChange={e => selectVersion(e.target.value)}>{task.data.results.map(x => <option key={x.id} value={x.id}>R{x.number} · {new Date(x.createdAt).toLocaleString('zh-CN')}</option>)}</select></label><PromptEditor key={result.id} task={task.data} result={result} refresh={reload} onDirtyChange={setDirtyResultId}/></> : null}
    {canvas && result && !dirty ? <Suspense fallback={<Message>正在打开画布导入…</Message>}><CanvasImportModal task={task.data} result={result} onClose={() => setCanvas(false)}/></Suspense> : null}
    {pendingVersion ? <Modal title="未保存的修改" onClose={() => setPendingVersion(null)}><p>当前提示词有未保存的修改。</p><div className="modal-footer"><button onClick={() => setPendingVersion(null)}>继续编辑</button><button className="primary" onClick={() => { setVersion(pendingVersion); setPendingVersion(null); setDirtyResultId(null); setCanvas(false); }}>放弃修改并继续</button></div></Modal> : null}
    {generate ? <Modal title="确认继续生成提示词" onClose={() => setGenerate(false)}><p>将使用 1 次文字额度，把本次任务快照中的商品和脚本发送到配置的服务。不调用生图或视频接口。</p><AsyncButton className="primary" action={submit}>确认并提交</AsyncButton></Modal> : null}
  </>;
}
