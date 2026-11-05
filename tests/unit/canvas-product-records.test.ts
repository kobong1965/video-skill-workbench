import { describe, expect, it } from 'vitest';
import type { PromptOutput, TaskSnapshot } from '../../packages/contracts';
import { planCanvasImport } from '../../packages/canvas/planner';
import { planCanvasLayout } from '../../packages/canvas/layout';
import { importInfo, importSteps, type ImportRow } from '../../packages/canvas/import-service';

const ids = ['9100000000000001001', '9100000000000004000'];
function fixture() {
  const snapshot = {
    input: { market: 'US', voice: 'inherit', productUse: 'outfit', productGroups: ids.map((productId, index) => ({
      source: 'catalog', catalogSelectionId: `selection-${index}`, styleNumber: 'same-sku', name: `商品${index}`, mediaIds: [`image-${index}`],
      catalog: { selectionId: `selection-${index}`, productUid: `product-${index}`, category: index ? 'women' : 'men', sku: 'same-sku', name: `商品${index}`,
        binding: { shopName: index ? 'DEMA' : 'DEMOB', market: 'US', productId, productUrl: null, matchStatus: 'image_matched' },
        sourceHash: 'a'.repeat(64), sourceUpdatedAt: '2026-10-31T00:00:00Z', selectedAt: '2026-11-04T01:00:00Z', assets: [] },
    })) },
    skills: [{ id: 'skill-a', versionId: 'a', name: '第一脚本' }, { id: 'skill-b', versionId: 'b', name: '第二脚本' }],
    capability: { min: 1, max: 15 }, media: ids.map((_, index) => ({ id: `image-${index}`, role: 'product', name: `商品${index}.png`, mime: 'image/png' })),
  } as unknown as TaskSnapshot;
  const output: PromptOutput = { globalPrompt: '保持商品与动作一致。', productFacts: [], unknowns: [], conflicts: [], assetPlan: [],
    shots: ['a', 'a', 'b'].map(skillVersionId => ({ skillVersionId, duration: 10, title: '展示', prompt: '真实展示商品。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: ['image-0', 'image-1'] })) };
  return { snapshot, output };
}

describe('画布商品资料记录', () => {
  it('每脚本保存一个可见资料节点，不混入批次视频或生成提示词，完整区分同款号不同店铺', () => {
    const { snapshot, output } = fixture();
    const plan = planCanvasImport('product-record-import', snapshot, output, []);
    const records = plan.batches.flatMap(batch => batch.texts.filter(text => text.purpose === 'product-record'));
    expect(records).toHaveLength(2);
    expect(new Set(records.map(record => record.name)).size).toBe(2);
    for (const record of records) for (const text of [...ids, 'DEMOB', 'DEMA', 'same-sku', 'product-0', 'product-1', '2026-11-04T01:00:00Z']) expect(record.content).toContain(text);
    for (const batch of plan.batches) for (const id of ids) {
      expect(batch.video.prompt).not.toContain(id);
      expect(batch.texts.filter(text => text.purpose !== 'product-record').map(text => text.content).join('')).not.toContain(id);
    }
    expect(plan.productBindings?.map(binding => binding.productId)).toEqual(ids);
    snapshot.input.productGroups![0].catalog!.binding.productId = '1732000000000000000';
    expect(plan.productBindings?.[0].productId).toBe(ids[0]);
    const layout = planCanvasLayout(plan);
    for (const record of records) expect(layout.groups.filter(group => group.nodeKeys.includes(record.name))).toHaveLength(1);
    const rectangles = Object.values(layout.positions);
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
    }
  });

  it('导入记录公开只读商品摘要并沿用步骤节点映射，不泄漏原图路径或全部来源资产', () => {
    const { snapshot, output } = fixture();
    const plan = planCanvasImport('record-summary', snapshot, output, []);
    const steps = importSteps(plan);
    expect(steps.filter(step => step.label.includes('商品资料记录'))).toHaveLength(2);
    const info = importInfo({ id: 'import', task_id: 'task', result_id: 'result', plan, steps, status: 'queued' } as ImportRow);
    expect(info.productBindings?.map(binding => binding.productId)).toEqual(ids);
    expect(JSON.stringify(info.productBindings)).not.toContain('assets');
  });

  it('旧任务不猜测商品ID；声明来自产品表却缺少绑定快照时停止导入', () => {
    const { snapshot, output } = fixture();
    delete snapshot.input.productGroups;
    const legacy = planCanvasImport('legacy', snapshot, output, []);
    expect(legacy.productBindings ?? []).toEqual([]);
    expect(legacy.batches.flatMap(batch => batch.texts).some(text => text.purpose === 'product-record')).toBe(false);
    const broken = fixture().snapshot;
    delete broken.input.productGroups![0].catalog;
    expect(() => planCanvasImport('missing', broken, output, [])).toThrow('商品绑定快照');
  });

  it('六款长名称分成安全大小的资料节点，商品ID不会被截断到两个节点', () => {
    const { snapshot, output } = fixture();
    const group = snapshot.input.productGroups![0];
    snapshot.input.productGroups = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(group), catalogSelectionId: `long-${index}`,
      catalog: { ...structuredClone(group.catalog!), selectionId: `long-${index}`, productUid: `long-product-${index}`, name: '长'.repeat(2000) } }));
    const plan = planCanvasImport('long-product-record', snapshot, output, []);
    const records = plan.batches[0].texts.filter(text => text.purpose === 'product-record');
    expect(records.length).toBeGreaterThan(1);
    expect(records.every(text => text.content.length <= 10000)).toBe(true);
    expect(records.slice(0, -1).every(text => text.content.endsWith('\n'))).toBe(true);
    const occurrences = records.reduce((count, record) => count + record.content.split(ids[0]).length - 1, 0);
    expect(occurrences).toBe(6);
    expect(records.map(record => record.content).join('')).toContain(`商品 ID：${ids[0]}`);
  });
});
