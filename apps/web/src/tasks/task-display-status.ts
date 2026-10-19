import type { TaskProgress } from '../../../../packages/contracts';

type DisplayStatus = { label: string; tone: 'active' | 'ready' | 'issue' | 'idle' };
const states: Record<TaskProgress['stage'], DisplayStatus> = {
  draft: { label: '未开始', tone: 'idle' }, queued: { label: '排队中', tone: 'active' },
  preparing: { label: '正在生成', tone: 'active' }, waiting: { label: '正在生成', tone: 'active' },
  validating: { label: '正在生成', tone: 'active' }, saving: { label: '正在生成', tone: 'active' },
  ready: { label: '已完成', tone: 'ready' }, failed: { label: '生成失败', tone: 'issue' },
  unknown: { label: '连接中断', tone: 'issue' }, invalid: { label: '结果需修正', tone: 'issue' },
};
const legacyStages: Record<string, TaskProgress['stage']> = {
  queued: 'queued', processing: 'waiting', running: 'waiting', completed: 'ready', succeeded: 'ready',
  awaiting_confirmation: 'ready', awaiting_assets: 'ready', failed: 'failed', unknown: 'unknown', invalid: 'invalid',
};
export function taskDisplayStatus(progress?: TaskProgress, status = ''): DisplayStatus {
  return states[progress?.stage ?? legacyStages[status] ?? 'draft'];
}
