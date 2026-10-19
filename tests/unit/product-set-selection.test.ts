import { describe, expect, it } from 'vitest';
import { productSetPatch, productSetsPatch, productUsePatch, productGroupsError, removeProductImage } from '../../apps/web/src/products/product-set-selection';
import type { CreationInput, ProductImageSet } from '../../packages/contracts';

const set = {
  id: '11111111-1111-4111-8111-111111111111', styleNumber: 'SKU-5007', name: '阔腿裤',
  media: [
    { id: '22222222-2222-4222-8222-222222222222', role: 'product' as const, name: '正面.png' },
    { id: '33333333-3333-4333-8333-333333333333', role: 'detail' as const, name: '背面.png' },
  ], createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
};

describe('款号图套载入创作', () => {
  it('复用已保存的文件 ID 和图片用途，不产生新上传或覆盖脚本设置', () => {
    const patch = productSetPatch(set);
    expect(patch).toMatchObject({ productSetId: set.id, styleNumber: 'SKU-5007', productName: '阔腿裤', facts: '', extra: '', media: set.media.map(({ id, role }) => ({ id, role })) });
    expect(patch).not.toHaveProperty('selections');
    expect(patch).not.toHaveProperty('market');
    expect(patch).not.toHaveProperty('targetDuration');
  });
  it('未填写商品名称时以款号作为商品名', () => {
    expect(productSetPatch({ ...set, name: '' }).productName).toBe('SKU-5007');
  });
  it('载入后修改本次图片角色不会改动原图套', () => {
    const patch = productSetPatch(set);
    patch.media[0].role = 'comparison';
    expect(set.media[0].role).toBe('product');
  });
  it('换成另一个款号时清空上一件商品事实，同款重新选取则保留', () => {
    const changed = productSetPatch(set, { productSetId: 'old-product-set', facts: '上一款的价格和成分', extra: '上一款专属卖点' });
    expect(changed.facts).toBe(''); expect(changed.extra).toBe('');
    const reloaded = productSetPatch(set, { productSetId: set.id, facts: '本款已确认商品信息', extra: '本款拍摄补充' });
    expect(reloaded.facts).toBe('本款已确认商品信息'); expect(reloaded.extra).toBe('本款拍摄补充');
  });
});

function imageSet(index: number, count = 6): ProductImageSet {
  return { ...set, id: `set-${index}`, styleNumber: `6258-${index}`, name: `颜色${index}`, media: Array.from({ length: count }, (_, n) => ({ id: `image-${index}-${n}`, role: n ? 'detail' : 'product', name: `颜色${index}-${n}.png` })) };
}
function creation(patch: Partial<CreationInput> = {}): CreationInput {
  return { name: '', media: [], platform: 'tiktok', market: 'US', category: '服装', targetDuration: 15, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'inherit', selections: [], productName: '', facts: '', audience: '', personNotes: '', sceneNotes: '', extra: '', ...patch };
}

describe('多款号图套映射', () => {
  it('三组各六张按顺序完整保留，不覆盖脚本或平台设置', () => {
    const sets = [imageSet(1), imageSet(2), imageSet(3)];
    const patch = productSetsPatch(sets, 'colors');
    expect(patch.media).toHaveLength(18);
    expect(patch.productGroups?.map(group => group.productSetId)).toEqual(sets.map(item => item.id));
    expect(patch.productGroups?.[2]).toEqual({ productSetId: sets[2].id, styleNumber: sets[2].styleNumber, name: sets[2].name, mediaIds: sets[2].media.map(item => item.id) });
    expect(patch.productUse).toBe('colors');
    expect(patch).not.toHaveProperty('selections'); expect(patch).not.toHaveProperty('market');
    expect(patch.productSetId).toBeUndefined(); expect(patch.styleNumber).toBeUndefined();
  });
  it('同组重载保留事实，顺序或用途变化清理旧商品描述', () => {
    const sets = [imageSet(1), imageSet(2)];
    const previous = creation({ ...productSetsPatch(sets, 'colors'), facts: '已确认材质', extra: '展示浅色' });
    expect(productSetsPatch(sets, 'colors', previous)).toMatchObject({ facts: '已确认材质', extra: '展示浅色' });
    expect(productSetsPatch([...sets].reverse(), 'colors', previous)).toMatchObject({ facts: '', extra: '' });
    expect(productSetsPatch(sets, 'outfit', previous)).toMatchObject({ facts: '', extra: '' });
  });
  it('对比第一组为主商品，其他组图片全部是比较图，恢复搭配后还原图套角色', () => {
    const sets = [imageSet(1), imageSet(2)];
    const comparison = creation(productSetsPatch(sets, 'comparison'));
    expect(comparison.media.slice(0, 6).map(item => item.role)).toEqual(['product', 'detail', 'detail', 'detail', 'detail', 'detail']);
    expect(comparison.media.slice(6).every(item => item.role === 'comparison')).toBe(true);
    const restored = productUsePatch(comparison, 'outfit', sets);
    expect(restored.media?.slice(6).map(item => item.role)).toEqual(['product', 'detail', 'detail', 'detail', 'detail', 'detail']);
    expect(sets[1].media[0].role).toBe('product');
  });
  it('切换用途不重新加回已移除的图片，并保留无分组补充图', () => {
    const sets = [imageSet(1), imageSet(2)];
    const input = creation(productSetsPatch(sets, 'comparison'));
    const reduced = { ...input, ...removeProductImage(input, sets[1].media[2].id) };
    reduced.media.push({ id: 'supplement', role: 'detail' });
    const patch = productUsePatch(reduced, 'colors', sets);
    expect(patch.media).toHaveLength(12);
    expect(patch.media?.some(item => item.id === sets[1].media[2].id)).toBe(false);
    expect(patch.media?.at(-1)).toEqual({ id: 'supplement', role: 'detail' });
    expect(patch.productGroups?.[1].mediaIds).not.toContain(sets[1].media[2].id);
  });
  it('相同媒体只传输一次但保留各组归属', () => {
    const a = imageSet(1), b = imageSet(2);
    b.media[1] = { ...a.media[1] };
    const patch = productSetsPatch([a, b], 'outfit');
    expect(patch.media).toHaveLength(11);
    expect(patch.productGroups?.every(group => group.mediaIds.includes(a.media[1].id))).toBe(true);
  });
  it('共享图片在不同图套的原用途冲突时明确拒绝，不静默改成主商品', () => {
    const a = imageSet(1), b = imageSet(2);
    b.media[1] = { ...a.media[0], role: 'detail' };
    expect(() => productSetsPatch([a, b], 'outfit')).toThrow('用途不一致');
    const original = creation(productSetsPatch([a], 'colors'));
    const groups = [{ productSetId: a.id, styleNumber: a.styleNumber, name: a.name, mediaIds: [a.media[0].id] }, { productSetId: b.id, styleNumber: b.styleNumber, name: b.name, mediaIds: [a.media[0].id] }];
    expect(() => productUsePatch({ ...original, productGroups: groups }, 'outfit', [a, b])).toThrow('用途不一致');
  });
  it('超过六组或三十六张时拒绝，不静默截断', () => {
    expect(() => productSetsPatch(Array.from({ length: 7 }, (_, n) => imageSet(n)), 'colors')).toThrow('6');
    expect(() => productSetsPatch([imageSet(1, 12), imageSet(2, 12), imageSet(3, 12), imageSet(4)], 'colors')).toThrow('36');
    expect(productSetsPatch(Array.from({ length: 6 }, (_, n) => imageSet(n)), 'colors').media).toHaveLength(36);
  });
  it('组内没有有效主图时阻止下一步，包括对比商品归错角色', () => {
    const sets = [imageSet(1), imageSet(2)];
    const input = creation(productSetsPatch(sets, 'colors'));
    const noMain = { ...input, ...removeProductImage(input, sets[1].media[0].id) };
    expect(productGroupsError(noMain)).toContain(sets[1].styleNumber);
    expect(productGroupsError(input)).toBe('');
    const comparison = creation(productSetsPatch(sets, 'comparison'));
    comparison.media[6].role = 'product';
    expect(productGroupsError(comparison)).toContain('对比');
  });
  it('移除图片同步组内关系，全部移除时仍保留空组以提示补齐或移除该款号', () => {
    const input = creation(productSetsPatch([imageSet(1, 1), imageSet(2, 1)], 'colors'));
    const patch = removeProductImage(input, 'image-2-0');
    expect(patch.productGroups?.[1].mediaIds).toEqual([]);
    expect(productGroupsError({ ...input, ...patch })).toContain('6258-2');
  });
  it('分组引用缺失图片或主组和对比组共用图片时在下一步之前报错', () => {
    const a = imageSet(1), b = imageSet(2);
    const input = creation(productSetsPatch([a, b], 'colors'));
    input.productGroups![1].mediaIds.push('not-in-task');
    expect(productGroupsError(input)).toContain('6258-2');
    b.media[1] = { ...a.media[1] };
    expect(() => productSetsPatch([a, b], 'comparison')).toThrow('不能共用');
  });
});
