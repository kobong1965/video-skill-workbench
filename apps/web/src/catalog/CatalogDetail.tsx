import type { CatalogProduct } from '../../../../packages/contracts/product-catalog';
import { api, copyText } from '../api';
import { AsyncButton, Icon } from '../ui';
import { useWorkspace } from '../workspace';
import { CatalogMedia } from './CatalogMedia';
import { bindingStatus, categoryLabels, copyBinding, productLink } from './presentation';

export function CatalogDetail({ product, revision }: { product: CatalogProduct; revision: number }) {
  const { notify } = useWorkspace();
  return <section className="panel catalog-detail" aria-label="产品详情">
    <header className="catalog-detail-header"><div><div className="tags"><span className="tag blue">{categoryLabels[product.category]}</span>{product.sourceMissing ? <span className="tag yellow">来源已缺失</span> : null}</div><h2>{product.sku} {product.name}</h2><p className="muted">{product.assets.filter(asset => asset.mediaType === 'image').length} 张图片 · {product.assets.filter(asset => asset.mediaType === 'video').length} 条视频</p></div></header>
    {product.sourceMissing ? <p className="catalog-source-warning">源清单已不再登记此款，保留上次资料供核对，不会自动删除原文件。</p> : null}
    <div className="catalog-facts"><p><strong>标题：</strong>{product.title || '未提供'}</p><p><strong>尺码：</strong>{product.sizes.length ? product.sizes.join(' / ') : '未提供'}</p>{product.note ? <p><strong>备注：</strong>{product.note}</p> : null}<small>资料编号：{product.id}</small></div>
    <CatalogMedia key={product.productUid} product={product} revision={revision}/>
    <section className="catalog-bindings" aria-label="店铺商品绑定"><h3>店铺与商品</h3>{product.shopBindings.length ? product.shopBindings.map((binding, index) => {
      const href = productLink(binding.productUrl);
      return <article className="catalog-binding" key={`${binding.shopName}:${binding.market}:${binding.productId}:${index}`}>
        <div className="inline between"><strong>{binding.shopName} · {binding.market}</strong><span className="tag gray">{bindingStatus(binding.matchStatus)}</span></div>
        <div className="catalog-product-id"><span>商品 ID</span><code>{binding.productId || '未提供'}</code>{binding.productId ? <AsyncButton aria-label={`复制 ${binding.shopName} 商品 ID`} action={async () => { await copyText(binding.productId); notify('商品 ID 已复制'); }}><Icon name="copy"/>复制 ID</AsyncButton> : null}</div>
        <p>商品链接：{href ? <a className="catalog-product-link" href={href} target="_blank" rel="noopener noreferrer">{binding.productUrl}</a> : binding.productUrl ? '链接格式无效，保留于绑定资料' : '未提供'}</p>
        {binding.sourceType || binding.matchedOn || binding.visualMatchNotes || binding.evidence?.length ? <details className="catalog-binding-source"><summary>查看绑定来源{binding.evidence?.length ? ` · ${binding.evidence.length} 项证据` : ''}</summary><div>{binding.sourceType ? <p>资料来源：{binding.sourceType === 'user_screenshot' ? '用户截图' : binding.sourceType}</p> : null}{binding.matchedOn ? <p>核对日期：{binding.matchedOn}</p> : null}{binding.visualMatchNotes ? <p>核对说明：{binding.visualMatchNotes}</p> : null}{binding.evidence?.length ? <p>已保留 {binding.evidence.length} 项来源证据，可通过“复制绑定资料”查看完整登记信息。</p> : null}</div></details> : null}
        <AsyncButton className="text-button" action={async () => { await copyText(copyBinding(product, binding)); notify('绑定资料已复制'); }}><Icon name="copy"/>复制绑定资料</AsyncButton>
      </article>;
    }) : <p className="muted">未提供店铺绑定</p>}</section>
    <section className="catalog-folders" aria-label="登记文件夹"><h3>本地文件夹</h3>{product.folders.length ? <div className="catalog-folder-actions">{product.folders.map(folder => <AsyncButton key={folder.id} disabled={!folder.available} aria-label={`打开文件夹：${folder.label}`} title={folder.available ? folder.label : '登记文件夹不可用'} action={async () => { await api(`/api/product-catalog/${encodeURIComponent(product.productUid)}/folders/${encodeURIComponent(folder.id)}/open`, 'POST', {}); notify('已打开登记文件夹'); }}><Icon name="catalog"/>{folder.label}{!folder.available ? ' · 不可用' : ''}<Icon name="arrow"/></AsyncButton>)}</div> : <p className="muted">未提供本地文件夹</p>}</section>
  </section>;
}
