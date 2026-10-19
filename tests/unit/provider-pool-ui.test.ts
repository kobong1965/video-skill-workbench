import { describe, expect, it } from 'vitest';
import { providerDraft, providerPayload, textProviderReady } from '../../apps/web/src/admin/provider-pool';
import { assignedProviderLabel, taskQueueCounts } from '../../apps/web/src/tasks/task-routing';
import type { TaskSummary } from '../../packages/contracts';

const legacy = { enabled: true, configured: true, hasKey: true, vision: true };

describe('接口池前端行为', () => {
  it('首个接口停用时仍可使用其他启用的视觉接口；显式空池不能复活旧配置', () => {
    expect(textProviderReady([{ ...legacy, enabled: false }, legacy], legacy, false)).toBe(true);
    expect(textProviderReady([], legacy, true)).toBe(false);
    expect(textProviderReady([{ ...legacy, enabled: false }], legacy, true)).toBe(false);
    expect(textProviderReady(undefined, legacy, false)).toBe(true);
  });
  it('保留单人图片输入规则，多用户仅接受已确认视觉的接口', () => {
    const nonVision = { ...legacy, vision: false };
    expect(textProviderReady([nonVision], legacy, true)).toBe(true);
    expect(textProviderReady([nonVision], legacy, false)).toBe(false);
  });
  it('编辑旧节点时使用稳定 ID，空密钥不提交，也不发送公开占位状态', () => {
    const draft = providerDraft({ ...legacy, model: 'old-model', name: '原接口', activeJobs: 2 }, 'text');
    const payload = providerPayload({ ...draft, name: '改名后', model: 'new-model' }, 'text');
    expect(payload.id).toBe('legacy-text');
    expect(payload.model).toBe('new-model');
    expect(payload).not.toHaveProperty('apiKey');
    expect(payload).not.toHaveProperty('hasKey');
    expect(payload).not.toHaveProperty('activeJobs');
    expect(payload.maxConcurrency).toBe(4);
  });
  it('只提交用户新填的密钥，并保留其他节点自己的 ID', () => {
    const draft = providerDraft({ ...legacy, id: 'second-node', model: 'model-2' }, 'text');
    expect(providerPayload({ ...draft, apiKey: 'fixture-new-key' }, 'text')).toMatchObject({ id: 'second-node', apiKey: 'fixture-new-key', model: 'model-2' });
    expect(providerPayload(draft, 'text', true).vision).toBe(true);
  });
});

describe('实际接口分配展示', () => {
  it('未分配的排队任务不借用全局配置冒充路由，已分配显示公开名称和模型', () => {
    expect(assignedProviderLabel({ provider: null })).toBeNull();
    expect(assignedProviderLabel(undefined)).toBeNull();
    expect(assignedProviderLabel({ provider: { id: 'p1', name: '备用视觉', model: 'vision-model-b' } })).toBe('备用视觉 · vision-model-b');
  });
  it('分别汇总运行与排队计划，完成和中断不占运行计数', () => {
    const stages = ['waiting', 'saving', 'queued', 'ready', 'unknown', 'failed'] as const;
    const tasks = stages.map(stage => ({ progress: { stage } })) as TaskSummary[];
    expect(taskQueueCounts(tasks)).toEqual({ running: 2, queued: 1 });
  });
});
