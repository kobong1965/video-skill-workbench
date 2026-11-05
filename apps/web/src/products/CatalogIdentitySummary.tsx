import type { ProductGroup } from '../../../../packages/contracts';
import './catalog-identity.css';

/** Display the saved identity, never look up a current SKU to rewrite history. */
export function CatalogIdentitySummary({ groups = [] }: { groups?: ProductGroup[] }) {
  const recorded = groups.filter(group => group.source === 'catalog' && group.catalog);
  if (!recorded.length) return null;
  return <section className="catalog-identity-summary" aria-label="选用时的商品资料">
    <h3>选用时的商品资料</h3>
    <ul>{recorded.map(group => {
      const catalog = group.catalog!;
      return <li key={group.catalogSelectionId}>
        <strong>{group.styleNumber} · {group.name}</strong>
        <span>{catalog.category === 'women' ? '女装' : '男装'} · {catalog.binding.shopName} · {catalog.binding.market}</span>
        <span className="catalog-identity-id">商品 ID：<code>{catalog.binding.productId}</code></span>
      </li>;
    })}</ul>
    <small>保存选用时的店铺与商品 ID；产品表后续更新不会改变本次记录。导入画布时独立留档，不作为视频提示词。</small>
  </section>;
}
