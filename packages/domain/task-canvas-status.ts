import type { TaskCanvasUploadSummary } from '../contracts';

export interface TaskCanvasImport {
  id: string; resultId: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
  projectId: string | null; updatedAt: string | Date;
}

const priority = (status: TaskCanvasImport['status']) => status === 'succeeded' ? 0 : ['queued', 'running'].includes(status) ? 1 : 2;

/** Records have already been filtered to the task and its owner by the caller. */
export function taskCanvasStatus(latestResultId: string | null, imports: TaskCanvasImport[]): TaskCanvasUploadSummary {
  const selected = imports.filter(item => latestResultId !== null && item.resultId === latestResultId)
    .sort((a, b) => priority(a.status) - priority(b.status) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.id.localeCompare(b.id))[0];
  const status = !selected ? 'not_uploaded' : selected.status === 'succeeded' ? 'uploaded'
    : ['queued', 'running'].includes(selected.status) ? 'uploading' : selected.status === 'failed' ? 'failed' : 'unknown';
  return {
    status, resultId: latestResultId, importId: selected?.id ?? null,
    projectId: selected?.projectId ?? null,
    projectUrl: selected?.projectId ? `https://www.liblib.tv/canvas?projectId=${encodeURIComponent(selected.projectId)}` : null,
    updatedAt: selected ? new Date(selected.updatedAt).toISOString() : null,
    previouslyUploaded: imports.some(item => item.status === 'succeeded' && item.resultId !== latestResultId),
  };
}
