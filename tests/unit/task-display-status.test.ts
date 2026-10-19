import { expect, it } from 'vitest';
import { taskDisplayStatus } from '../../apps/web/src/tasks/task-display-status';
import type { TaskProgress } from '../../packages/contracts';

it.each(['preparing', 'waiting', 'validating', 'saving'] as const)('%s 显示中文正在生成，不编造百分比', stage => {
  expect(taskDisplayStatus({ stage, label: '接口内部阶段', value: null }, 'processing')).toEqual({ label: '正在生成', tone: 'active' });
});
it.each([
  ['ready', '已完成', 'ready'], ['queued', '排队中', 'active'], ['draft', '未开始', 'idle'],
  ['failed', '生成失败', 'issue'], ['unknown', '连接中断', 'issue'], ['invalid', '结果需修正', 'issue'],
] as const)('%s 状态显示 %s', (stage, label, tone) => {
  expect(taskDisplayStatus({ stage, label: '原始阶段', value: stage === 'ready' ? 100 : null }, 'completed')).toEqual({ label, tone });
});
it('兼容旧摘要且不把未知响应当完成', () => {
  expect(taskDisplayStatus(undefined, 'awaiting_confirmation').label).toBe('已完成');
  expect(taskDisplayStatus(undefined, 'processing').label).toBe('正在生成');
  expect(taskDisplayStatus(undefined, 'unknown').label).toBe('连接中断');
  expect(taskDisplayStatus(undefined, 'unrecognized').label).toBe('未开始');
});
