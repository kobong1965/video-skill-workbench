import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProductGroup } from '../../packages/contracts';
import { CatalogIdentitySummary } from '../../apps/web/src/products/CatalogIdentitySummary';

function group(shopName: string, productId: string): ProductGroup {
  return {
    source: 'catalog', catalogSelectionId: `selection-${shopName}`,
    styleNumber: 'SKU-6121', name: '破洞牛仔裤', mediaIds: ['media-1'],
    catalog: { productUid: `product-${shopName}`, category: 'men', sku: 'SKU-6121', name: '破洞牛仔裤',
      binding: { shopName, market: 'US', productId }, selectedAt: '2026-10-31T08:00:00Z' },
  } as ProductGroup;
}

describe('任务及导入中的商品身份摘要', () => {
  it('完整显示各店铺的字符串商品ID而不合并同款号', () => {
    const html = renderToStaticMarkup(createElement(CatalogIdentitySummary, { groups: [group('DEMOB', '9100000000000002001'), group('DEMA', '9100000000000003001')] }));
    expect(html).toContain('DEMOB'); expect(html).toContain('DEMA');
    expect(html).toContain('9100000000000002001'); expect(html).toContain('9100000000000003001');
    expect(html.match(/SKU-6121/g)).toHaveLength(2);
    expect(html).toContain('选用时的商品资料');
  });
  it('不为旧手动任务猜测商品ID或创建资料记录', () => {
    const html = renderToStaticMarkup(createElement(CatalogIdentitySummary, { groups: [{ productSetId: 'manual', styleNumber: '6121', name: '', mediaIds: [] }] }));
    expect(html).toBe('');
    expect(renderToStaticMarkup(createElement(CatalogIdentitySummary, {}))).toBe('');
  });
});
