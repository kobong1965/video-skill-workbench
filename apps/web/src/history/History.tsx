import { api } from '../api';
import { useLoad, useWorkspace } from '../workspace';
import { Empty, Message, statusLabel, AsyncButton } from '../ui';
import type { CreationInput, TaskInfo } from '../../../../packages/contracts';

export function History() {
  const { navigate, start } = useWorkspace();
  const tasks = useLoad<{ id: string; name: string; status: string; createdAt: string }[]>('/api/tasks');
  const drafts = useLoad<{ id: string; name: string; input: Partial<CreationInput>; updatedAt: string }[]>('/api/drafts');
  return <div className="stack">{tasks.error || drafts.error ? <Message error>{tasks.error || drafts.error}</Message> : null}<section><h2>生成任务</h2>{tasks.data?.length ? <div className="list">{tasks.data.map(task => <div className="list-row" key={task.id}><div><h3>{task.name}</h3><p>{new Date(task.createdAt).toLocaleString('zh-CN')} · {statusLabel[task.status] ?? task.status}</p></div><div className="row-actions"><AsyncButton action={async () => { const detail = await api<TaskInfo>(`/api/tasks/${task.id}`); start({ ...detail.snapshot.input, parentId: task.id, name: `${task.name} · 新创作` }); }}>另存新创作</AsyncButton><button onClick={() => navigate(`task/${task.id}`)}>打开</button></div></div>)}</div> : <Empty title="还没有生成任务"><p>从一张商品图和一个脚本开始，结果会自动保存在这里。</p><button onClick={() => start()}>开始创作</button></Empty>}</section><section><h2>未完成草稿</h2>{drafts.data?.length ? <div className="list">{drafts.data.map(draft => <div className="list-row" key={draft.id}><div><h3>{draft.name}</h3><p>{new Date(draft.updatedAt).toLocaleString('zh-CN')} · 已保存输入</p></div><button onClick={() => start({ ...draft.input, _draftId: draft.id })}>继续创作</button></div>)}</div> : <p className="muted">上传商品或修改内容后会自动保存草稿。</p>}</section></div>;
}
