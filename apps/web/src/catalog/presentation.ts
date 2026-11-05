import type { CatalogProduct } from '../../../../packages/contracts/product-catalog';

export const categoryLabels = { women: '女装', men: '男装' } as const;
export const assetLabels = { main: '主图', detail: '详情图', reference: '参考图', video: '视频' } as const;
export const localCatalogAllowed = (admin: boolean, singleUser: boolean, hostname = location.hostname) => admin && singleUser && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

export function filterProducts(products: CatalogProduct[], category: CatalogProduct['category'], shop: string, search: string) {
  const term = search.trim().toLocaleLowerCase();
  return products.filter(product => product.category === category
    && (!shop || product.shopBindings.some(binding => binding.shopName === shop))
    && (!term || [product.sku, product.name, product.title, ...product.shopBindings.map(binding => binding.productId)].some(value => value.toLocaleLowerCase().includes(term))));
}

export function formatCatalogDate(value: string | null) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未提供' : date.toLocaleString('zh-CN', { hour12: false });
}

export function bindingStatus(value: string) {
  return ({ matched: '已匹配', image_matched: '图片已核对', unverified: '待核对', unmatched: '未匹配', conflict: '存在冲突' } as Record<string, string>)[value] ?? (value || '未提供');
}

export function productLink(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function copyBinding(product: CatalogProduct, binding: CatalogProduct['shopBindings'][number]) {
  return JSON.stringify({ productUid: product.productUid, category: product.category, sku: product.sku, name: product.name, ...binding }, null, 2);
}
