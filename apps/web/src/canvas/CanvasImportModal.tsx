import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResultRevision, TaskInfo } from '../../../../packages/contracts';
import type { CanvasConnection as Connection, CanvasProjects as Destinations, CanvasImportInfo as ImportRecord } from '../../../../packages/canvas/contracts';
import { api } from '../api';
import { AsyncButton, Message, Modal } from '../ui';
import { useLoad, useWorkspace } from '../workspace';
import { CatalogIdentitySummary } from '../products/CatalogIdentitySummary';
import './canvas.css';

function ImportProgress({ record, update }: { record: ImportRecord; update: (record: ImportRecord) => void }) {
  const [error, setError] = useState('');
  const active = record.status === 'queued' || record.status === 'running';
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('workbench:tasks-changed'));
  }, [record.id, record.status]);
  useEffect(() => {
    if (!active) return;
    let mounted = true; let busy = false;
    const timer = setInterval(async () => {
      if (busy) return; busy = true;
      try { const next = await api<ImportRecord>(`/api/canvas/imports/${record.id}`); if (mounted) { setError(''); update(next); } }
      catch (e) { if (mounted) setError((e as Error).message); }
      finally { busy = false; }
    }, 1500);
    return () => { mounted = false; clearInterval(timer); };
  }, [active, record.id, update]);
  return <section className="canvas-import-status" aria-label="画布导入进度">
    <div className="panel-header"><h3>{record.status === 'succeeded' ? '工作流已建立' : active ? '正在建立工作流' : record.status === 'unknown' ? '导入状态待核对' : '导入未完成'}</h3><span>{record.progress}%</span></div>
    <progress max={100} value={record.progress} aria-label="工作流建立进度"/>
    <ol>{record.steps.map(step => <li key={step.key} data-status={step.status}><span aria-hidden="true">{step.status === 'succeeded' ? '✓' : step.status === 'running' ? '◌' : '·'}</span>{step.label}</li>)}</ol>
    {record.error || error ? <Message error>{record.error || error}</Message> : null}
    <div className="inline">
      {record.projectUrl ? <a className="canvas-open" href={record.projectUrl} target="_blank" rel="noreferrer" aria-label="打开画布">打开画布 ↗</a> : null}
      {['failed', 'unknown'].includes(record.status) ? <AsyncButton action={async () => { update(await api<ImportRecord>(`/api/canvas/imports/${record.id}/retry`, 'POST', { key: crypto.randomUUID() })); }}>继续导入</AsyncButton> : null}
    </div>
  </section>;
}

function DestinationForm({ task, result, onImported }: { task: TaskInfo; result: ResultRevision; onImported: (record: ImportRecord) => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [workspace, setWorkspace] = useState(''); const [projectId, setProjectId] = useState('');
  const [name, setName] = useState(`${task.name.slice(0, 65)} · 视频工作流`);
  const [destinations, setDestinations] = useState<Destinations | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const requestVersion = useRef(0);
  const loadPage = useCallback(async (nextPage: number) => {
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    if (nextPage === 1) {
      setDestinations(previous => previous ? { ...previous, projects: [], total: 0 } : null);
      setProjectId(''); setPage(1); setHasMore(false);
    }
    const query = new URLSearchParams({ page: String(nextPage), pageSize: '50', ...(workspace ? { workspace } : {}) });
    try {
      const next = await api<Destinations>(`/api/canvas/projects?${query}`);
      if (version !== requestVersion.current) return;
      setDestinations(previous => ({ ...next, projects: [...new Map([
        ...(nextPage > 1 ? previous?.projects ?? [] : []), ...next.projects,
      ].map(project => [project.id, project])).values()] }));
      setPage(nextPage); setHasMore(next.projects.length > 0 && nextPage * 50 < next.total);
    } catch (e) { if (version === requestVersion.current) setError((e as Error).message); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [workspace]);
  useEffect(() => { void loadPage(1); return () => { requestVersion.current++; }; }, [loadPage]);
  const { notify } = useWorkspace();
  return <div className="form-stack">
    <div className="checkbox-row"><label className="check-label"><input type="radio" name="canvas-mode" checked={mode === 'new'} onChange={() => setMode('new')}/>新建画布</label><label className="check-label"><input type="radio" name="canvas-mode" checked={mode === 'existing'} onChange={() => setMode('existing')}/>使用已有画布</label></div>
    {mode === 'new' ? <label>画布名称<input value={name} maxLength={100} onChange={e => setName(e.target.value)}/></label> : <>
      {destinations?.workspaces.length ? <label>项目空间<select aria-label="项目空间" value={workspace} onChange={e => {
        requestVersion.current++; setWorkspace(e.target.value); setProjectId('');
        setDestinations(previous => previous ? { ...previous, projects: [], total: 0 } : null); setHasMore(false);
      }}><option value="">全部</option><option value="0">根目录</option>{destinations.workspaces.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : null}
      <label>目标画布<select aria-label="目标画布" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">{loading ? '正在读取画布…' : '选择画布'}</option>{destinations?.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      {hasMore ? <button disabled={loading} onClick={() => void loadPage(page + 1)}>{loading ? '正在读取画布…' : '加载更多画布'}</button> : null}
      {error ? <Message error>{error}<button disabled={loading} onClick={() => void loadPage(1)}>刷新画布</button></Message> : null}
    </>}
    <div className="modal-footer"><AsyncButton className="primary" disabled={mode === 'new' ? !name.trim() : !projectId} action={async () => {
      const record = await api<ImportRecord>(`/api/tasks/${task.id}/canvas-imports`, 'POST', { key: crypto.randomUUID(), resultId: result.id, ...(mode === 'new' ? { newProjectName: name.trim() } : { projectId }) });
      onImported(record); notify('已提交画布导入');
    }}>创建工作流</AsyncButton></div>
  </div>;
}

export function CanvasImportModal({ task, result, onClose }: { task: TaskInfo; result: ResultRevision; onClose: () => void }) {
  const connection = useLoad<Connection>('/api/canvas/connection');
  const history = useLoad<ImportRecord[]>(`/api/tasks/${task.id}/canvas-imports?resultId=${result.id}`);
  const [record, setRecord] = useState<ImportRecord | null>(null); const [newImport, setNewImport] = useState(false);
  const shown = record ?? (!newImport ? history.data?.[0] : null);
  return <Modal title="导入 LibTV 画布" onClose={onClose}>
    <div className="form-stack"><p className="canvas-import-summary">R{result.number} · {task.snapshot.media.filter(media => media.mime.startsWith('image/')).length} 张商品／参考图 · 不自动生成</p>
      <CatalogIdentitySummary groups={task.snapshot.input.productGroups}/>
      {connection.error ? <Message error>{connection.error}</Message> : null}
      {!connection.data ? <Message>正在连接 LibTV…</Message> : !connection.data.connected ? <Message error>{connection.data.error || 'LibTV 尚未登录，请先在本机登录 LibTV 官方 CLI。'}<button onClick={() => void connection.refresh()}>重新连接</button></Message> : <small>LibTV · {connection.data.accountName || '已连接'}</small>}
      {shown ? <><ImportProgress record={shown} update={setRecord}/>{shown.status === 'succeeded' ? <button className="text-button" onClick={() => { setRecord(null); setNewImport(true); }}>导入到另一个画布</button> : null}</> : history.loading ? <Message>正在读取导入记录…</Message> : history.error ? <Message error>{history.error}<button onClick={() => void history.refresh()}>重新读取</button></Message> : connection.data?.connected ? <DestinationForm task={task} result={result} onImported={setRecord}/> : null}
      <small>仅建立工作流，不自动生成。模型、时长、比例和声音由你在画布中确认。</small>
    </div>
  </Modal>;
}
