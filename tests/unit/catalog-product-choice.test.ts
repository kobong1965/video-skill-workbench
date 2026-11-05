import { describe, expect, it } from 'vitest';
import { productSetsPatch, productUsePatch, productGroupsError } from '../../apps/web/src/products/product-set-selection';
import { savedOptions } from '../../apps/web/src/products/picker-options';

const choice = (id = 'choice-1', shopName = 'DEMA', productId = '9100000000000004000') => ({
  id, source: 'catalog' as const, styleNumber: 'H9002', name: '双扣牛仔裤', createdAt: '', updatedAt: '',
  media: [{ id: `${id}-main`, role: 'product' as const, name: '主图.png' }, { id: `${id}-detail`, role: 'detail' as const, name: '细节.png' }],
  catalog: { selectionId: id, productUid: 'product-1', category: 'women' as const, sku: 'H9002', name: '双扣牛仔裤',
    binding: { shopName, market: 'US' as const, productId, productUrl: null, matchStatus: 'image_matched' },
    sourceHash: 'hash', sourceUpdatedAt: '', selectedAt: '', assets: [] },
});

describe('产品表选款映射', () => {
  it('损坏草稿的产品表来源不被伪装成手动图套，明确要求重新选择', () => {
    const option = savedOptions([{ source: 'catalog', catalogSelectionId: 'receipt', styleNumber: 'H9002', name: '', mediaIds: [] }])[0];
    expect(option.key).toBe('catalog-invalid:receipt');
    expect(option.disabledReason).toContain('商品绑定快照缺失');
    expect(option.savedUrl).toBeUndefined();
  });
  it('保存独立选用身份和完整商品ID，不冒充手动图套', () => {
    const item = choice();
    const patch = productSetsPatch([item], 'colors');
    expect(patch.productSetId).toBeUndefined();
    expect(patch.productGroups?.[0]).toMatchObject({ source: 'catalog', catalogSelectionId: item.id, catalog: item.catalog });
    expect(patch.productGroups?.[0].productSetId).toBeUndefined();
    expect(patch).toMatchObject({ market: 'US', platform: 'tiktok' });
    expect(patch.productGroups?.[0].catalog?.binding.productId).toBe('9100000000000004000');
  });
  it('同款不同店铺独立保存，调序与用途变更不丢绑定', () => {
    const a = choice(), b = choice('choice-2', 'DEMOB', '9100000000000004001');
    const patch = productSetsPatch([a, b], 'comparison');
    expect(patch.productGroups?.map(group => group.catalog?.binding.shopName)).toEqual(['DEMA', 'DEMOB']);
    const restored = productUsePatch({ ...patch, productGroups: [...patch.productGroups!].reverse() }, 'outfit', [a, b]);
    expect(restored.productGroups?.map(group => group.catalog?.binding.productId)).toEqual(['9100000000000004001', '9100000000000004000']);
    expect(restored.media.filter(file => file.role === 'product')).toHaveLength(2);
  });
  it('从产品表换回手动图套不残留旧ID', () => {
    const previous = productSetsPatch([choice()], 'colors');
    const manual = { id: 'manual', styleNumber: 'H9002', name: '', media: choice().media, createdAt: '', updatedAt: '' };
    const patch = productSetsPatch([manual], 'colors', { ...previous, facts: '旧资料', extra: '' });
    expect(patch.productGroups?.[0].catalog).toBeUndefined();
    expect(patch.productGroups?.[0].source).toBeUndefined();
    expect(patch.facts).toBe('');
  });
  it('同一商品同一绑定的两个选用修订不能作为两个款号重复选中', () => {
    expect(() => productSetsPatch([choice(), choice('other-version')], 'colors')).toThrow('同一商品');
  });
  it('选用图套不能超过12图，界面不静默截取', () => {
    const item = choice(); item.media = Array.from({ length: 13 }, (_, n) => ({ ...item.media[0], id: String(n) }));
    expect(() => productSetsPatch([item], 'colors')).toThrow('12');
  });
});
