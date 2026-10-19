import { describe, expect, it } from 'vitest';
import { canvasPromptsEqual } from '../../packages/canvas/prompt';

describe('画布提示词回读比较', () => {
  it.each([
    ['完全相同', '镜头 1\n展示商品', '镜头 1\n展示商品'],
    ['CLI 移除末尾 LF', '镜头 1\n展示商品\n', '镜头 1\n展示商品'],
    ['CLI 移除末尾 CRLF', '镜头 1\r\n展示商品\r\n', '镜头 1\n展示商品'],
    ['统一内部 CRLF 与 LF', '镜头 1\r\n\r\n展示商品', '镜头 1\n\n展示商品'],
    ['首尾空格和制表符', ' \t镜头 1\n展示商品 \t', '镜头 1\n展示商品'],
    ['首尾多个空行', '\n\r\n镜头 1\n展示商品\n\n', '镜头 1\n展示商品'],
    ['回读首尾有空白', '镜头 1\n展示商品', '\t\r\n镜头 1\r\n展示商品\n '],
  ])('%s 仍视为同一提示词', (_name, expected, actual) => {
    expect(canvasPromptsEqual(expected, actual)).toBe(true);
  });

  it.each([
    ['内部空格被删除', '保持 商品原色', '保持商品原色'],
    ['内部空格增加', '保持 商品原色', '保持  商品原色'],
    ['内部空行被删除', '镜头 1\n\n展示商品', '镜头 1\n展示商品'],
    ['内部换行被换为空格', '镜头 1\n展示商品', '镜头 1 展示商品'],
    ['内部缩进变化', '镜头 1\n  展示商品', '镜头 1\n展示商品'],
    ['内部单独 CR 不视为 LF', '镜头 1\r展示商品', '镜头 1\n展示商品'],
    ['数字变化', '镜头 1｜12 秒', '镜头 1｜15 秒'],
    ['正文变化', '不展示商标', '展示商标'],
    ['标点变化', 'Look at this!', 'Look at this.'],
    ['大小写变化', 'Look at this!', 'look at this!'],
  ])('%s 必须阻止覆盖', (_name, expected, actual) => {
    expect(canvasPromptsEqual(expected, actual)).toBe(false);
  });

  it.each([
    ['缺少回读字段', '镜头 1\n展示商品', undefined],
    ['回读为 null', '镜头 1\n展示商品', null],
    ['回读为数字', '12', 12],
    ['回读为布尔值', 'true', true],
    ['回读为数组', '镜头 1\n展示商品', ['镜头 1\n展示商品']],
    ['回读为对象', '镜头 1\n展示商品', { prompt: '镜头 1\n展示商品' }],
    ['回读为空', '镜头 1\n展示商品', ''],
    ['回读仅空白', '镜头 1\n展示商品', ' \t\r\n'],
    ['计划和回读都为空', '', ''],
    ['计划和回读都仅空白', ' \t\r\n', '\n'],
    ['计划为空而回读有正文', '', '镜头 1\n展示商品'],
  ] as [string, string, unknown][])('%s 不得视为可安全覆盖', (_name, expected, actual) => {
    expect(canvasPromptsEqual(expected, actual)).toBe(false);
  });
});
