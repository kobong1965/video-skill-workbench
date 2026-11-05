import { expect, it } from 'vitest';
import type { TaskSnapshot } from '../../packages/contracts';
import { buildTextRequest } from '../../packages/providers/text';

it('商品身份只留在任务与画布记录，不发送给文本生成模型，商品图与分组保持', () => {
  const snapshot = { input: { market: 'US', voice: 'none', productGroups: [{
    source: 'catalog', catalogSelectionId: 'private-selection', styleNumber: 'SKU-6121', name: '破洞裤', mediaIds: ['image-1'],
    catalog: { productUid: 'private-product', binding: { shopName: 'PRIVATE_SHOP', productId: '9100000000000003001' }, assets: [], sourceHash: 'private-hash' },
  }] }, media: [{ id: 'image-1', role: 'product', name: '主图', mime: 'image/png' }], skills: [] } as unknown as TaskSnapshot;
  const before = structuredClone(snapshot);
  const result = JSON.stringify(buildTextRequest(snapshot, [{ id: 'image-1', role: 'product', mime: 'image/png', bytes: Buffer.from('image-test') }]));
  for (const value of ['private-selection', 'private-product', 'PRIVATE_SHOP', '9100000000000003001', 'private-hash', 'catalogSelectionId']) expect(result).not.toContain(value);
  for (const value of ['SKU-6121', 'image-1', '破洞裤', 'image_url']) expect(result).toContain(value);
  expect(snapshot).toEqual(before);
});
