import { describe, expect, it } from 'vitest';
import { canvasImportOrigin } from '../../packages/canvas/import-service';
import { assertImportCommand } from '../../packages/canvas/cli';

describe('已有画布的导入避让', () => {
  it('空画布使用原点，有节点时计算最右完整边界并留出组间空隙', () => {
    expect(canvasImportOrigin([])).toEqual({ x: 0, y: 0 });
    expect(canvasImportOrigin([
      { position: { x: -24, y: 136 } },
      { position: { x: 2184, y: 0 }, width: 622, height: 350 },
      { position: { x: 1350, y: 0 } },
    ])).toEqual({ x: 3306, y: 0 });
  });
  it('已有节点尺寸未知时保守预留，坐标未知时停止而非覆盖原点', () => {
    expect(canvasImportOrigin([{ position: { x: 5000, y: 0 } }]).x).toBe(6500);
    expect(() => canvasImportOrigin([{ id: 'unknown' }])).toThrow('节点位置');
    expect(() => canvasImportOrigin([{ position: { x: NaN } }])).toThrow('节点位置');
  });
  it('分组后的子节点使用父组相对坐标，逐级累计后避让', () => {
    const graph = [
      { id: 'outer', position: { x: 5000, y: 0 }, width: 100 },
      { id: 'inner', parentId: 'outer', position: { x: 2000, y: 0 }, width: 100 },
      { id: 'child', parentId: 'inner', position: { x: 1500, y: 0 }, width: 800 },
    ];
    expect(canvasImportOrigin(graph).x).toBe(9800);
    expect(() => canvasImportOrigin([{ ...graph[2], parentId: 'missing' }])).toThrow('分组位置');
    expect(() => canvasImportOrigin([{ id: 'cycle', parentId: 'cycle', position: { x: 0 } }])).toThrow('分组位置');
  });
  it('允许分组创建与回读，拒绝切换默认组及触发生成', () => {
    expect(() => assertImportCommand(['group', 'create', '脚本一', '-p', 'canvas', '--node', 'image'])).not.toThrow();
    expect(() => assertImportCommand(['group', 'group-id', '-p', 'canvas'])).not.toThrow();
    for (const operation of ['use', 'unuse', 'delete']) expect(() => assertImportCommand(['group', operation])).toThrow();
    expect(() => assertImportCommand(['group', 'create', '脚本', '--run'])).toThrow('不允许触发生成');
  });
});
