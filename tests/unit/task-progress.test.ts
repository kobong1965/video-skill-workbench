import { describe, expect, it } from 'vitest';
import { taskProgress } from '../../packages/domain/task-progress';

describe('任务栏展示持久化阶段，不推测上游完成百分比', () => {
  it('新任务与排队任务为零，重试时忽略上一次留下的阶段', () => {
    expect(taskProgress('draft', null, false)).toEqual({ stage: 'draft', label: '未开始', value: 0 });
    expect(taskProgress('queued', { kind: 'text', status: 'queued', payload: { _progress: { stage: 'saving' } } }, false))
      .toEqual({ stage: 'queued', label: '排队中', value: 0 });
  });

  it('准备请求、等待上游、校验、保存都显示不定进度', () => {
    const job = { kind: 'text' as const, status: 'running' };
    expect(taskProgress('processing', job, false)).toEqual({ stage: 'preparing', label: '准备请求', value: null });
    expect(taskProgress('processing', { ...job, sentAt: '2026-10-18T10:00:00Z' }, false))
      .toEqual({ stage: 'waiting', label: '生成提示词中', value: null });
    expect(taskProgress('processing', { ...job, payload: { _progress: { stage: 'validating' } } }, false))
      .toEqual({ stage: 'validating', label: '校验返回结果', value: null });
    expect(taskProgress('processing', { ...job, payload: { _progress: { stage: 'saving' } } }, false))
      .toEqual({ stage: 'saving', label: '保存结果', value: null });
  });

  it('成功或已经存在结果的任务显示完成', () => {
    expect(taskProgress('awaiting_confirmation', { kind: 'text', status: 'succeeded' }, true))
      .toEqual({ stage: 'ready', label: '提示词已生成', value: 100 });
    expect(taskProgress('completed', null, true).value).toBe(100);
    expect(taskProgress('awaiting_image_confirmation', { kind: 'image', status: 'succeeded' }, true).label).toBe('图片已生成');
  });

  it.each(['failed', 'unknown', 'invalid'] as const)('真实 %s 状态优先于旧结果和旧进度', status => {
    expect(taskProgress('partial', { kind: 'text', status, payload: { _progress: { stage: 'saving' } } }, true))
      .toMatchObject({ stage: status, value: null });
  });

  it('没有阶段信息的旧任务保留真实状态，旧图片任务也能显示等待阶段', () => {
    expect(taskProgress('unknown', null, false)).toMatchObject({ stage: 'unknown', value: null });
    expect(taskProgress('processing', { kind: 'image', status: 'running', sentAt: '2026-10-18T10:00:00Z' }, true))
      .toEqual({ stage: 'waiting', label: '生成图片中', value: null });
    expect(taskProgress('processing', { kind: 'text', status: 'running', payload: { _progress: { stage: 'ready', value: 97 } } }, false))
      .toMatchObject({ stage: 'preparing', value: null });
  });
});
