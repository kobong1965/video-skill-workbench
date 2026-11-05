import { useEffect, useRef, useState } from 'react';
import { MAX_PRODUCT_GROUPS, MAX_TASK_IMAGES, type ProductGroup, type ProductImageSet } from '../../../../packages/contracts';
import type { CatalogSnapshot } from '../../../../packages/contracts/product-catalog';
import { api } from '../api';
import { useLoad } from '../workspace';
import { Empty, Icon, Message, Modal } from '../ui';
import type { ProductChoice } from '../products/product-choice';
import { catalogOptions, manualOptions, savedOptions, optionLabel, type PickerOption } from '../products/picker-options';
import { ProductChoiceGrid } from './ProductChoiceGrid';
import './product-set-picker.css';

export function ProductSetPicker({ initialGroups = [], initialIds = [], allowCatalog = false, onChoose, onClose }: {
  initialGroups?: ProductGroup[]; initialIds?: string[]; allowCatalog?: boolean; onChoose: (sets: ProductChoice[]) => void; onClose: () => void;
}) {
  const sets = useLoad<ProductImageSet[]>('/api/product-sets');
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(allowCatalog);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState(''); const [source, setSource] = useState('');
  const [category, setCategory] = useState(''); const [shop, setShop] = useState('');
  const [selected, setSelected] = useState<PickerOption[]>(() => savedOptions(initialGroups.length ? initialGroups : initialIds.map(id => ({ productSetId: id, styleNumber: '已选图套', name: '', mediaIds: [] }))));
  const [selecting, setSelecting] = useState(false); const [error, setError] = useState('');
  const active = useRef(true); const closeHandler = useRef(onClose); closeHandler.current = onClose;
  useEffect(() => {
    active.current = true;
    const invalidate = () => { active.current = false; closeHandler.current(); };
    window.addEventListener('hashchange', invalidate);
    if (allowCatalog) void api<CatalogSnapshot>('/api/product-catalog').then(value => { if (active.current) setCatalog(value); })
      .catch(failure => { if (active.current) setCatalogError(failure.message); }).finally(() => { if (active.current) setCatalogLoading(false); });
    return () => { active.current = false; window.removeEventListener('hashchange', invalidate); };
  }, [allowCatalog]);
  const options = [...(allowCatalog && catalog ? catalogOptions(catalog) : []), ...manualOptions(sets.data ?? [])];
  const term = query.trim().toLocaleLowerCase();
  const visible = options.filter(option => (!source || option.source === source) && (!category || option.category === category)
    && (!shop || option.binding?.shopName === shop) && `${optionLabel(option)} ${option.name}`.toLocaleLowerCase().includes(term));
  const shops = [...new Set(catalog?.products.flatMap(product => product.shopBindings.map(binding => binding.shopName)) ?? [])];
  const count = new Set(selected.flatMap(option => option.imageKeys)).size;
  const busy = selecting || syncing;
  function toggle(option: PickerOption) {
    if (busy) return; setError('');
    if (selected.some(item => item.key === option.key)) { setSelected(items => items.filter(item => item.key !== option.key)); return; }
    if (option.disabledReason) { setError(option.disabledReason); return; }
    if (selected.length >= MAX_PRODUCT_GROUPS) { setError(`最多选择 ${MAX_PRODUCT_GROUPS} 个款号`); return; }
    const images = new Set([...selected, option].flatMap(item => item.imageKeys));
    if (images.size > MAX_TASK_IMAGES) { setError(`所选图套共 ${images.size} 张图，最多支持 ${MAX_TASK_IMAGES} 张，请减少图套`); return; }
    setSelected(items => [...items, option]);
  }
  function move(index: number, direction: number) {
    setSelected(items => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  function close() { active.current = false; onClose(); }
  async function syncCatalog() {
    if (busy) return; setSyncing(true); setCatalogError('');
    try {
      const next = await api<CatalogSnapshot>('/api/product-catalog/sync', 'POST');
      if (!active.current) return;
      setCatalog(next);
      if (selected.some(item => item.request)) { setSelected(items => items.filter(item => !item.request)); setError('产品表已刷新，请重新勾选未载入的产品；已保存款号仍保留原绑定。'); }
    } catch (failure) { if (active.current) setCatalogError((failure as Error).message); }
    finally { if (active.current) setSyncing(false); }
  }
  async function choose() {
    if (busy || !selected.length) return;
    const unavailable = selected.find(option => option.disabledReason || (!option.savedUrl && !option.request));
    if (unavailable) { setError(unavailable.disabledReason || '款号资料不可用，请重新选择'); return; }
    const route = location.hash; setSelecting(true); setError('');
    try {
      const latest: ProductChoice[] = [];
      for (const option of selected) {
        if (!active.current || location.hash !== route) return;
        latest.push(option.savedUrl ? await api<ProductChoice>(option.savedUrl)
          : await api<ProductChoice>('/api/product-catalog/selections', 'POST', option.request));
      }
      const total = new Set(latest.flatMap(set => set.media.map(file => file.id))).size;
      if (total > MAX_TASK_IMAGES) throw new Error(`图套已更新，现有 ${total} 张图，超过 ${MAX_TASK_IMAGES} 张；请调整选择，不会删图`);
      if (active.current && location.hash === route) onChoose(latest);
    } catch (failure) { if (active.current) setError((failure as Error).message); }
    finally { if (active.current) setSelecting(false); }
  }
  return <Modal title="选择款号" onClose={close}>
    <label className="product-set-picker-search">款号<input type="search" aria-label="搜索款号" placeholder="款号、商品名称、店铺或商品 ID" value={query} disabled={busy} onChange={event => setQuery(event.target.value)}/></label>
    {allowCatalog ? <><div className="catalog-picker-filters">
      <label>来源<select aria-label="款号来源" value={source} disabled={busy} onChange={event => { setSource(event.target.value); setCategory(''); setShop(''); }}><option value="">全部来源</option><option value="catalog">产品表</option><option value="manual">手动图套</option></select></label>
      <label>分类<select aria-label="款号分类" value={category} disabled={busy || source === 'manual'} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option><option value="women">女装</option><option value="men">男装</option></select></label>
      <label>店铺<select aria-label="款号店铺" value={shop} disabled={busy || source === 'manual'} onChange={event => setShop(event.target.value)}><option value="">全部店铺</option>{shops.map(name => <option key={name}>{name}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => void syncCatalog()}>{syncing ? '同步中…' : '同步产品表'}</button>
    </div><p className="catalog-picker-note">产品表款号使用美区 TikTok 设置；按店铺与商品 ID 分别选择。仅点击“使用”后保存图片副本及绑定，不生成或发布。</p></> : null}
    {sets.error || error ? <Message error>{sets.error || error}{sets.error ? <button onClick={() => void sets.refresh()}>重试图套</button> : null}</Message> : null}
    {catalogError || catalog?.stale ? <Message error>{catalogError || catalog?.error || '产品资料已过期，请重新同步'}</Message> : null}
    {sets.loading || catalogLoading ? <Message>正在读取款号…</Message> : visible.length ? <ProductChoiceGrid options={visible} selected={selected} disabled={busy} toggle={toggle}/>
      : <Empty title={term ? '没有匹配的款号' : '暂无可选款号'}><p>{term ? '请换一个款号、店铺或商品 ID。' : allowCatalog ? '同步产品表后选择，或在素材页保存手动图套。' : '可在素材页保存款号和产品图片。'}</p></Empty>}
    {selected.length ? <ol className="product-set-selected-order" aria-label="已选款号">{selected.map((option, index) => {
      const label = optionLabel(option);
      return <li key={option.key}><span><b>{index + 1}</b>{label}{option.disabledReason ? ` · ${option.disabledReason}` : ''}</span><div className="inline">
        <button type="button" aria-label={`上移款号：${label}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
        <button type="button" aria-label={`下移款号：${label}`} disabled={busy || index === selected.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button type="button" aria-label={`移除款号：${label}`} disabled={busy} onClick={() => toggle(option)}><Icon name="close"/></button>
      </div></li>;
    })}</ol> : null}
    <div className="modal-footer product-set-picker-footer"><span role="status">{selected.length} / {MAX_PRODUCT_GROUPS} 套 · {count} / {MAX_TASK_IMAGES} 张</span><button type="button" onClick={close}>取消</button><button type="button" className="primary" aria-label="使用所选款号" disabled={busy || !selected.length || sets.loading || catalogLoading} aria-busy={selecting || undefined} onClick={() => void choose()}>{selecting ? '载入中' : '使用'}</button></div>
  </Modal>;
}
