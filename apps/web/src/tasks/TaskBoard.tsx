import type { TaskSummary } from '../../../../packages/contracts';
import { Icon, Message } from '../ui';
import { useWorkspace } from '../workspace';
import { TaskMedia } from './TaskMedia';
import { taskDisplayStatus } from './task-display-status';
import { assignedProviderLabel, taskQueueCounts } from './task-routing';
import { CanvasUploadBadge } from './CanvasUploadBadge';
import { useTaskSummaries } from './use-task-summaries';
import './tasks.css';

export function TaskCard({ task, selected }: { task: TaskSummary; selected: boolean }) {
  const { navigate } = useWorkspace();
  const progress = task.progress;
  const status = taskDisplayStatus(progress, task.status);
  const failed = status.tone === 'issue';
  const provider = assignedProviderLabel(task.latestJob);
  return <article className={`task-card ${selected ? 'selected' : ''} ${failed ? 'task-issue' : ''}`} aria-label={task.name}>
    <TaskMedia task={task} onOpen={() => navigate(`task/${task.id}`)}/>
    <div className="task-card-body">
      <span className={`task-state task-state-${status.tone}`} title={progress?.label} aria-label={`${task.name}状态：${status.label}`}>{status.label}</span>
      <CanvasUploadBadge task={task}/>
      {provider ? <span className="task-provider" title={provider} aria-label={`分配接口：${provider}`}>{provider}</span> : null}
      <button className="task-details" onClick={() => navigate(`task/${task.id}`)} aria-label={`查看详情：${task.name}`} title={task.name}>详情<Icon name="arrow"/></button>
    </div>
  </article>;
}

export function TaskBoard({ route }: { route: string }) {
  const { start } = useWorkspace();
  const tasks = useTaskSummaries('/api/task-board');
  const counts = taskQueueCounts(tasks.data ?? []);
  return <aside className="task-board" aria-label="任务栏">
    <header className="task-board-header"><div><h2>任务栏</h2>{counts.running > 0 ? <span className="tag blue">{counts.running} 个生成中</span> : null}{counts.queued > 0 ? <span className="tag gray">{counts.queued} 个排队中</span> : null}</div><button onClick={() => start()} aria-label="新建任务"><Icon name="plus"/>新建</button></header>
    {tasks.error ? <Message error>{tasks.error}<button onClick={() => void tasks.refresh()}>刷新</button></Message> : null}
    <div className="task-board-list" tabIndex={0} aria-label="任务列表">
      {tasks.data?.map(task => <TaskCard key={task.id} task={task} selected={route === `task/${task.id}`}/>)}
      {!tasks.data?.length ? <div className="task-board-empty">{tasks.loading ? '正在读取任务…' : '暂无任务'}</div> : null}
    </div>
  </aside>;
}
