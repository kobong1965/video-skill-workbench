import type { JobInfo, TaskJobSummary, TaskSummary } from '../../../../packages/contracts';

type RoutedJob = Pick<JobInfo | TaskJobSummary, 'provider'>;
export function assignedProviderLabel(job?: RoutedJob | null): string | null {
  if (!job?.provider) return null;
  return `${job.provider.name} · ${job.provider.model}`;
}
export function taskQueueCounts(tasks: TaskSummary[]) {
  return tasks.reduce((counts, task) => {
    if (task.progress.stage === 'queued') counts.queued++;
    else if (['preparing', 'waiting', 'validating', 'saving'].includes(task.progress.stage)) counts.running++;
    return counts;
  }, { running: 0, queued: 0 });
}
