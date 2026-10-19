import { describe, expect, it } from 'vitest';
import type { CanvasPlan } from '../../packages/canvas/planner';
import { planCanvasLayout, type CanvasRect } from '../../packages/canvas/layout';

const overlaps = (a: CanvasRect, b: CanvasRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (child: CanvasRect, parent: CanvasRect) => child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height;
function example(): CanvasPlan {
  return {
    materials: ['a', 'b'].map(id => ({ id, sourceId: 'same-product', name: id, kind: 'product', batch: null, mime: 'image/png' })),
    batches: [1, 2].map(number => ({ number, groupKey: `group-${number}`, materialIds: [number === 1 ? 'a' : 'b'], texts: [{ name: `text-${number}`, content: '中文商品展示。' }], video: { name: `video-${number}`, prompt: '完整提示词。' } })),
    groups: [1, 2].map(number => ({ key: `group-${number}`, name: `脚本${number}`, materialIds: [number === 1 ? 'a' : 'b'], batchNumbers: [number] })),
  };
}

describe('按脚本分组的画布布局', () => {
  it('每套脚本独占完整区域，组内节点都在组边界内并按素材、文本、视频排列', () => {
    const layout = planCanvasLayout(example());
    expect(layout.groups).toHaveLength(2);
    expect(overlaps(layout.groups[0].bounds, layout.groups[1].bounds)).toBe(false);
    for (const group of layout.groups) for (const key of group.nodeKeys) expect(inside(layout.positions[key], group.bounds)).toBe(true);
    expect(layout.positions.a.x + layout.positions.a.width).toBeLessThan(layout.positions['text-1'].x);
    expect(layout.positions['text-1'].x + layout.positions['text-1'].width).toBeLessThan(layout.positions['video-1'].x);
    expect(layout.groups[1].bounds.y).toBeGreaterThan(layout.groups[0].bounds.y + layout.groups[0].bounds.height);
  });

  it('多图、长文本和多个批次撑开本组，后续脚本不会挤进前一组', () => {
    const plan = example();
    const extra = Array.from({ length: 11 }, (_, index) => ({ id: `extra-${index}`, name: `商品${index}`, kind: 'product', batch: null, mime: 'image/png' }));
    plan.materials.push(...extra);
    plan.groups![0].materialIds.push(...extra.map(material => material.id));
    plan.batches[0].materialIds.push(...extra.map(material => material.id));
    plan.batches[0].texts = [1, 2].map(number => ({ name: `long-${number}`, content: '完整台词、动作与音乐说明。\n'.repeat(200) }));
    plan.batches.push({ number: 3, groupKey: 'group-1', materialIds: ['a'], texts: [{ name: 'text-3', content: '本脚本第二批' }], video: { name: 'video-3', prompt: '继续本脚本' } });
    plan.groups![0].batchNumbers.push(3);
    const layout = planCanvasLayout(plan);
    const entries = Object.values(layout.positions);
    for (let left = 0; left < entries.length; left++) for (let right = left + 1; right < entries.length; right++) expect(overlaps(entries[left], entries[right])).toBe(false);
    for (const group of layout.groups) for (const key of group.nodeKeys) expect(inside(layout.positions[key], group.bounds)).toBe(true);
    expect(layout.positions['text-3'].y).toBeGreaterThan(layout.positions['long-2'].y + layout.positions['long-2'].height);
    expect(overlaps(layout.groups[0].bounds, layout.groups[1].bounds)).toBe(false);
    expect(layout.groups[0].nodeKeys.filter(key => key === 'a')).toHaveLength(1);
  });

  it('旧计划没有分组字段时仍能计算一个完整区域，且不改变输入', () => {
    const plan = example(); delete plan.groups;
    const original = JSON.stringify(plan);
    const layout = planCanvasLayout(plan);
    expect(layout.groups).toHaveLength(1);
    expect(Object.keys(layout.positions)).toHaveLength(6);
    expect(JSON.stringify(plan)).toBe(original);
  });

  it('拒绝将另一脚本的素材节点连进本组', () => {
    const plan = example(); plan.batches[1].materialIds.push('a');
    expect(() => planCanvasLayout(plan)).toThrow('跨脚本');
  });
});
