import type { TaskProgress } from '../contracts';

interface ProgressJob {
  kind: 'text' | 'image';
  status: string;
  sentAt?: string | Date | null;
  payload?: Record<string, unknown>;
}
const errors: Record<string, TaskProgress> = {
  failed: { stage: 'failed', label: '生成失败', value: null },
  unknown: { stage: 'unknown', label: '连接中断', value: null },
  invalid: { stage: 'invalid', label: '返回结果需修正', value: null },
};

/** No elapsed-time estimates: the provider does not report completion percent. */
export function taskProgress(status: string, job: ProgressJob | null, hasResult: boolean): TaskProgress {
  const state = job?.status ?? status;
  if (state === 'queued') return { stage: 'queued', label: '排队中', value: 0 };
  if (errors[state]) return { ...errors[state] };
  if (state === 'running' || state === 'processing') {
    const stored = job?.payload?._progress;
    const stage = stored && typeof stored === 'object' && 'stage' in stored ? stored.stage : null;
    if (stage === 'validating') return { stage, label: '校验返回结果', value: null };
    if (stage === 'saving') return { stage, label: '保存结果', value: null };
    if (job?.sentAt) return { stage: 'waiting', label: job.kind === 'image' ? '生成图片中' : '生成提示词中', value: null };
    return { stage: 'preparing', label: '准备请求', value: null };
  }
  if (state === 'succeeded' || hasResult || status === 'completed') {
    return { stage: 'ready', label: job?.kind === 'image' ? '图片已生成' : '提示词已生成', value: 100 };
  }
  return { stage: 'draft', label: '未开始', value: 0 };
}
