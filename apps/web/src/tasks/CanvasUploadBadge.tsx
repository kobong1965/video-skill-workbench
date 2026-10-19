import type { TaskSummary } from '../../../../packages/contracts';
import './canvas-upload-status.css';

const states = {
  not_uploaded: { label: '未上传画布', tone: 'idle', description: '当前保存版本还没有成功上传画布的记录。' },
  uploading: { label: '上传画布中', tone: 'active', description: '当前保存版本正在上传画布，尚未确认完成。' },
  uploaded: { label: '已上传画布', tone: 'ready', description: '当前保存版本已成功上传画布并完成工作流核对。' },
  failed: { label: '画布上传失败', tone: 'issue', description: '当前保存版本的画布上传未完成，可打开详情查看。' },
  unknown: { label: '画布待确认', tone: 'issue', description: '画布上传结果尚待核对，不能视为上传成功，可打开详情查看。' },
} as const;

export function CanvasUploadBadge({ task }: { task: Pick<TaskSummary, 'name' | 'canvasUpload'> }) {
  const summary = task.canvasUpload;
  const state = states[summary?.status ?? 'unknown'];
  const description = !summary ? '暂未取得画布上传状态，请刷新后查看。' : state.description
    + (summary.previouslyUploaded && summary.status !== 'uploaded' ? ' 旧版本曾上传画布，该记录不代表当前版本已经上传。' : '');
  return <span className={`canvas-upload-badge canvas-upload-${state.tone}`} data-canvas-status={summary?.status ?? 'unknown'}
    title={description} aria-label={`${task.name}画布上传状态：${state.label}。${description}`}>
    <span className="canvas-upload-dot" aria-hidden="true"/>{state.label}
  </span>;
}
