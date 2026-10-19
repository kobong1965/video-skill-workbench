import { describe, expect, it } from 'vitest';
import { taskCanvasStatus, type TaskCanvasImport } from '../../packages/domain/task-canvas-status';

const current = 'current-result';
function record(id: string, status: TaskCanvasImport['status'], resultId = current, updatedAt = '2026-10-19T01:00:00Z'): TaskCanvasImport {
  return { id, resultId, status, projectId: status === 'succeeded' ? `project-${id}` : null, updatedAt };
}

describe('最新结果版本的画布上传状态', () => {
  it('没有结果或没有上传记录时不将生成完成误认为画布上传完成', () => {
    expect(taskCanvasStatus(null, [])).toMatchObject({ status: 'not_uploaded', resultId: null, previouslyUploaded: false, importId: null });
    expect(taskCanvasStatus(current, [])).toMatchObject({ status: 'not_uploaded', resultId: current, previouslyUploaded: false });
  });

  it('旧结果已上传不会让修改后的最新结果显示已上传', () => {
    expect(taskCanvasStatus(current, [record('old', 'succeeded', 'old-result')])).toMatchObject({ status: 'not_uploaded', resultId: current, importId: null, previouslyUploaded: true });
  });

  it.each(['queued', 'running'] as const)('%s只代表上传中，优先于较新的失败或中断', status => {
    expect(taskCanvasStatus(current, [record('active', status), record('failed', 'failed', current, '2026-10-19T02:00:00Z')])).toMatchObject({ status: 'uploading', importId: 'active' });
  });

  it('任一当前版本成功均保留已上传事实，不被后续失败、中断或再次上传覆盖', () => {
    const success = record('success', 'succeeded');
    for (const later of ['queued', 'running', 'failed', 'unknown'] as const) {
      expect(taskCanvasStatus(current, [success, record('later', later, current, '2026-10-19T02:00:00Z')])).toMatchObject({
        status: 'uploaded', importId: 'success', projectId: 'project-success',
        projectUrl: 'https://www.liblib.tv/canvas?projectId=project-success',
      });
    }
  });

  it('没有成功或进行中的上传时显示最后更新的失败或未知，续传旧记录的更新时间生效', () => {
    expect(taskCanvasStatus(current, [record('failed', 'failed'), record('unknown', 'unknown', current, '2026-10-19T02:00:00Z')])).toMatchObject({ status: 'unknown', importId: 'unknown' });
    expect(taskCanvasStatus(current, [record('failed', 'failed', current, '2026-10-19T03:00:00Z'), record('unknown', 'unknown', current, '2026-10-19T02:00:00Z')])).toMatchObject({ status: 'failed', importId: 'failed', updatedAt: '2026-10-19T03:00:00.000Z' });
  });
});
