import { expect, it } from 'vitest';
import type { Shot, TaskSnapshot } from '../../packages/contracts';
import { productGroupLabel, validateProductGroupReferences } from '../../packages/domain/product-groups';
import { planCanvasImport } from '../../packages/canvas/planner';

const snapshot = {
  input: { productUse: 'colors', productGroups: [
    { productSetId: 's1', styleNumber: '6258黑色', name: '黑色牛仔裤', mediaIds: ['black', 'black-back'] },
    { productSetId: 's2', styleNumber: '6258深蓝', name: '深蓝牛仔裤', mediaIds: ['blue'] },
    { productSetId: 's3', styleNumber: '6258浅蓝', name: '浅蓝牛仔裤', mediaIds: ['light'] },
  ] }, capability: { min: 4, max: 30 },
  media: ['black', 'black-back', 'blue', 'light'].map(id => ({ id, role: id === 'black-back' ? 'detail' : 'product', name: `${id}.png`, mime: 'image/png' })),
} as TaskSnapshot;
const shots = ['black', 'blue', 'light'].map(id => ({ references: [id], skillVersionId: 'skill', duration: 3, title: id, prompt: '对应款号展示', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '' } satisfies Shot));

it('多组必须在完整镜头列表实际引用每组，不以全局文字提到颜色替代引用', () => {
  expect(() => validateProductGroupReferences(snapshot, shots)).not.toThrow();
  expect(() => validateProductGroupReferences(snapshot, shots.slice(0, 2))).toThrow('6258浅蓝');
  expect(() => validateProductGroupReferences(snapshot, [{ ...shots[0], references: [] }])).toThrow('6258黑色');
  expect(() => validateProductGroupReferences({ media: snapshot.media } as TaskSnapshot, shots)).not.toThrow();
});

it('同一图片可属于多组，标签不能丢任何归属；对比主次明确', () => {
  const shared = { ...snapshot, input: { ...snapshot.input, productUse: 'comparison', productGroups: snapshot.input.productGroups!.map(group => ({ ...group, mediaIds: ['shared'] })) } } as TaskSnapshot;
  const label = productGroupLabel(shared, 'shared');
  expect(label).toContain('6258黑色'); expect(label).toContain('6258浅蓝');
  expect(label).toContain('主商品'); expect(label).toContain('对比商品');
});

it('画布素材和参考清单保留款号组映射，节点引用齐全且不生成', () => {
  const output = { globalPrompt: '同款三色换装展示，不生成视频', shots, productFacts: [], unknowns: [], conflicts: [], assetPlan: [] };
  const plan = planCanvasImport('multi-groups', snapshot, output, []);
  expect(plan.materials).toHaveLength(4);
  expect(plan.materials.find(item => item.id === 'blue')?.name).toContain('6258深蓝');
  expect(plan.batches[0].materialIds).toEqual(['black', 'blue', 'light']);
  const text = plan.batches[0].texts.map(item => item.content).join('');
  expect(text).toContain('6258黑色'); expect(text).toContain('6258深蓝'); expect(text).toContain('6258浅蓝');
  expect(() => planCanvasImport('missing', snapshot, { ...output, shots: shots.slice(0, 2) }, [])).toThrow('6258浅蓝');
});
