import { useEffect, useRef, useState } from 'react';
import type { CatalogProduct, CatalogSnapshot } from '../../../../packages/contracts/product-catalog';
import { api } from '../api';
import { Empty, Icon, Message } from '../ui';
import { useWorkspace } from '../workspace';
import { CatalogDetail } from './CatalogDetail';
import { CatalogImage } from './CatalogMedia';
import { categoryLabels, filterProducts, formatCatalogDate, localCatalogAllowed } from './presentation';
import './catalog.css';

export function ProductCatalog() {
  const { user, config } = useWorkspace();
  if (!localCatalogAllowed(user.role === 'admin', config.singleUserMode === true)) return <Message>产品表仅供本机管理员使用。请在本机单用户工作台打开。</Message>;
  return <CatalogWorkspace/>;
}

function CatalogWorkspace() {
  const { notify } = useWorkspace();
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<CatalogProduct['category']>('women');
  const [shop, setShop] = useState(''); const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    alive.current = true;
    let active = true;
    void api<CatalogSnapshot>('/api/product-catalog').then(value => { if (active) setSnapshot(value); }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; };
  }, []);
  async function sync() {
    if (syncing) return;
    setSyncing(true); setError(''); notify('');
    try {
      const value = await api<CatalogSnapshot>('/api/product-catalog/sync', 'POST', {});
      if (!alive.current) return;
      setSnapshot(previous => value.stale && !value.products.length && previous?.products.length ? { ...previous, stale: true, error: value.error } : value);
      if (!value.stale) { setRevision(previous => previous + 1); notify(`产品资料已同步：${value.counts.products} 款，男装 ${value.counts.men} 款、女装 ${value.counts.women} 款`); }
    } catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { if (alive.current) setSyncing(false); }
  }
  const products = snapshot?.products ?? [];
  const filtered = filterProducts(products, category, shop, search);
  const selected = filtered.find(product => product.productUid === selectedId) ?? filtered[0];
  const shops = [...new Set(products.filter(product => product.category === category).flatMap(product => product.shopBindings.map(binding => binding.shopName)))].sort((a, b) => a.localeCompare(b));
  const changeCategory = (value: CatalogProduct['category']) => { setCategory(value); setShop(''); setSelectedId(''); };
  const stale = Boolean(error || snapshot?.stale);
  return <div className="catalog-page">
    <header className="panel catalog-toolbar"><div className="catalog-intro"><span className="eyebrow">本地产品资料</span><p>按分类、店铺和款号查看资料，不影响创作任务。</p><small>来源：{snapshot?.sourceLabel ?? '美区产品表'} · 单向同步，只读保留原文件</small></div><button className="primary" aria-busy={syncing || undefined} disabled={loading || syncing} aria-label="同步产品资料" onClick={() => void sync()}><Icon name="refresh"/>{syncing ? '同步中…' : '同步产品资料'}</button><div className="catalog-sync-status"><span>{stale ? '同步未完成' : snapshot?.syncedAt ? '已同步' : '等待首次同步'}</span><span>上次同步：{formatCatalogDate(snapshot?.syncedAt ?? null)}</span>{snapshot?.sourceUpdatedAt ? <span>源资料更新：{formatCatalogDate(snapshot.sourceUpdatedAt)}</span> : null}</div></header>
    {stale ? <Message error>{error || snapshot?.error || '暂时无法同步源资料'}。{products.length ? '正在显示上次有效资料，未删除原文件或既有工作台内容。' : '请检查产品表来源后重试同步。'}</Message> : null}
    {loading ? <div className="panel catalog-loading" aria-busy="true" role="status">正在读取产品资料…</div> : !products.length ? <div className="panel"><Empty title="尚未同步产品资料"><p>点击“同步产品资料”，读取现有美区产品表。原软件和原图片会完整保留。</p></Empty></div> : <>
      <div className="panel catalog-filters"><div className="catalog-category-tabs" role="tablist" aria-label="产品分类">{(['women', 'men'] as const).map((value, index) => <button key={value} id={`catalog-tab-${value}`} role="tab" ref={element => { tabs.current[index] = element; }} tabIndex={category === value ? 0 : -1} aria-selected={category === value} aria-controls="catalog-results" aria-label={`${categoryLabels[value]} ${snapshot?.counts[value] ?? 0} 款`} onClick={() => changeCategory(value)} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; changeCategory(next === 0 ? 'women' : 'men'); tabs.current[next]?.focus(); }}>{categoryLabels[value]}<span className="tag gray">{snapshot?.counts[value] ?? 0}</span></button>)}</div><label className="catalog-search">搜索产品<div><Icon name="search"/><input type="search" aria-label="搜索产品" placeholder="款号、名称或商品 ID" value={search} onChange={event => setSearch(event.target.value)}/></div></label><label className="catalog-shop-filter">筛选店铺<select aria-label="筛选店铺" value={shop} onChange={event => setShop(event.target.value)}><option value="">全部店铺</option>{shops.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      <section id="catalog-results" role="tabpanel" aria-labelledby={`catalog-tab-${category}`} tabIndex={0}>
        {!filtered.length ? <div className="panel"><Empty title="没有匹配的款式"><p>试试其他款号、商品 ID 或店铺。</p><button onClick={() => { setShop(''); setSearch(''); }}>清空筛选</button></Empty></div> : <div className="catalog-columns"><aside className="catalog-directory" aria-label="款式目录"><div className="catalog-directory-heading"><h2>{categoryLabels[category]}款式</h2><span className="muted">{filtered.length} 款</span></div><div className="catalog-product-list">{filtered.map(product => <button className="catalog-product-card" key={product.productUid} aria-label={`查看款式：${product.sku} ${product.name}`} aria-pressed={selected?.productUid === product.productUid} onClick={() => setSelectedId(product.productUid)}><CatalogImage key={`${product.productUid}:${product.coverId}:${revision}`} asset={product.assets.find(asset => asset.id === product.coverId) ?? product.assets.find(asset => asset.mediaType === 'image')} alt=""/><span className="catalog-card-copy"><strong>{product.sku}</strong><span>{product.name}</span><small>{product.shopBindings.map(binding => binding.shopName).join(' / ') || '未绑定店铺'}</small>{product.sourceMissing ? <small className="catalog-source-missing">来源已缺失</small> : null}</span>{selected?.productUid === product.productUid ? <span className="catalog-selected-mark" aria-hidden="true"><Icon name="check"/></span> : null}</button>)}</div></aside>{selected ? <CatalogDetail key={selected.productUid} product={selected} revision={revision}/> : null}</div>}
      </section>
      <p className="catalog-footnote">共 {snapshot?.counts.products} 款 · 图片 {snapshot?.counts.images} 张 · 视频 {snapshot?.counts.videos} 条 · 登记文件夹 {snapshot?.counts.folders} 个。这里只同步资料，不会自动发起生成或发布。</p>
    </>}
  </div>;
}
