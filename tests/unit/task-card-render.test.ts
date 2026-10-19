import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TaskSummary } from '../../packages/contracts';
import { TaskCard } from '../../apps/web/src/tasks/TaskBoard';
import { WorkspaceContext, type Workspace } from '../../apps/web/src/workspace';

const workspace: Workspace = {
  user: { id: 'user-1', username: 'owner', displayName: '创作者', role: 'admin', active: true },
  config: { text: { enabled: true, configured: true, hasKey: true }, image: { enabled: false, configured: false, hasKey: false }, capabilities: {}, quotas: [] },
  preferences: {}, refreshConfig: async () => {}, notify: vi.fn(), navigate: vi.fn(), start: vi.fn(),
  registerDraftSaver: vi.fn(), registerNavigationGuard: vi.fn(),
};

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1', name: '白车库裤装12秒 · 新创作', status: 'awaiting_confirmation',
    createdAt: '2026-10-18T14:29:00Z', updatedAt: '2026-10-18T14:30:00Z', parentId: null,
    thumbnailMediaId: 'product-1', latestResultId: 'result-1', latestJob: null, activeJobs: 0,
    progress: { stage: 'ready', label: '提示词已生成', value: 100 }, ...overrides,
  };
}

function renderTask(summary: TaskSummary, selected = false) {
  return renderToStaticMarkup(createElement(WorkspaceContext.Provider, { value: workspace }, createElement(TaskCard, { task: summary, selected })));
}

describe('任务栏紧凑卡片', () => {
  it.each([
    ['not_uploaded', '未上传画布'], ['uploading', '上传画布中'], ['uploaded', '已上传画布'],
    ['failed', '画布上传失败'], ['unknown', '画布待确认'],
  ] as const)('独立显示%s画布状态，不改变已完成的生成状态', (status, label) => {
    const html = renderTask(task({ canvasUpload: { status, previouslyUploaded: false, resultId: 'result-1', importId: null, projectId: null, projectUrl: null, updatedAt: null } }));
    expect(html).toContain('状态：已完成');
    expect(html.replace(/<[^>]*>/g, '')).toContain(label);
    expect(html).toContain('画布上传状态：');
  });

  it('紧凑卡片显示商品与脚本封面及中文已完成，并保留查看详情', () => {
    const html = renderTask(task({ skillPreviews: [{ id: 'skill-1', versionId: 'version-1', name: '白车库脚本', imageMediaId: 'script-cover-1', videoMediaId: null }] }), true);
    expect(html.replace(/<[^>]*>/g, '')).toBe('商品脚本已完成画布待确认详情');
    expect(html).toContain('src="/api/media/product-1"');
    expect(html).toContain('src="/api/media/script-cover-1"');
    expect(html).toContain('alt="脚本封面：白车库脚本"');
    expect(html).toContain('aria-label="查看任务：白车库裤装12秒 · 新创作"');
    expect(html).toContain('aria-label="查看详情：白车库裤装12秒 · 新创作"');
    expect(html).toContain('class="task-card selected');
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain('状态：已完成');
  });

  it('上游未提供百分比时显示正在生成，不编造完成数值', () => {
    const html = renderTask(task({ status: 'processing', activeJobs: 1, latestResultId: null, progress: { stage: 'waiting', label: '生成提示词中', value: null } }));
    expect(html.replace(/<[^>]*>/g, '')).toBe('商品无封面脚本正在生成画布待确认详情');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow=');
    expect(html).toContain('状态：正在生成');
  });

  it('新任务如实显示未开始，按钮仍统一为查看详情', () => {
    const html = renderTask(task({ status: 'draft', latestResultId: null, progress: { stage: 'draft', label: '未开始', value: 0 } }));
    expect(html.replace(/<[^>]*>/g, '')).toBe('商品无封面脚本未开始画布待确认详情');
    expect(html).not.toContain('aria-valuenow=');
    expect(html).toContain('状态：未开始');
  });

  it.each(['failed', 'unknown', 'invalid'] as const)('真实 %s 状态仍可访问，但不在小卡片铺开错误详情', stage => {
    const error = '网络中断或响应超时，服务端可能已执行，请核对后决定是否重试';
    const html = renderTask(task({ status: stage, latestJob: { id: 'job-1', kind: 'text', status: stage, error, attempts: 1, createdAt: '2026-10-18T14:29:00Z', sentAt: null, finishedAt: null, progress: { stage, label: '连接中断', value: null } }, progress: { stage, label: '连接中断', value: null } }));
    expect(html.replace(/<[^>]*>/g, '')).toBe(`商品无封面脚本${({ failed: '生成失败', unknown: '连接中断', invalid: '结果需修正' })[stage]}画布待确认详情`);
    expect(html).toContain('task-issue');
    expect(html).toContain('task-state-issue');
    expect(html).not.toContain('aria-valuenow=');
    expect(html).not.toContain(error);
  });

  it('组合脚本全部保留顺序，不只显示第一套封面', () => {
    const html = renderTask(task({ skillPreviews: [
      { id: 'a', versionId: 'va', name: '惊讶开头', imageMediaId: 'cover-a', videoMediaId: null },
      { id: 'b', versionId: 'vb', name: '细节展示', imageMediaId: 'cover-b', videoMediaId: null },
    ] }));
    expect(html.indexOf('cover-a')).toBeLessThan(html.indexOf('cover-b'));
    expect(html).toContain('1/2'); expect(html).toContain('2/2');
    expect(html).toContain('所用脚本：惊讶开头'); expect(html).toContain('所用脚本：细节展示');
  });
});
