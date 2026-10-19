import { useEffect, useRef, useState } from 'react';
import type { ProductImageSet } from '../../../../packages/contracts';
import { api, mediaUrl } from '../api';
import { useLoad, useWorkspace } from '../workspace';
import { AsyncButton, Empty, Icon, Message, Modal } from '../ui';
import { ProductSetEditor } from './ProductSetEditor';
import { productSetPatch } from '../products/product-set-selection';

const roleLabels = { product: '主商品图', detail: '同款细节', comparison: '对比商品' };

export function ProductSetLibrary() {
  const library = useLoad<ProductImageSet[]>('/api/product-sets');
  const { start, notify } = useWorkspace();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ProductImageSet | 'new' | null>(null);
  const [detail, setDetail] = useState<ProductImageSet | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const query = search.trim().toLocaleLowerCase();
  const visible = library.data?.filter(set => `${set.styleNumber} ${set.name}`.toLocaleLowerCase().includes(query)) ?? [];
  async function useSet(set: ProductImageSet) {
    const latest = await api<ProductImageSet>(`/api/product-sets/${set.id}`);
    // A lazy route transition can retain the previous page while its chunk loads.
    if (active.current && location.hash === '#assets') start(productSetPatch(latest));
  }
  function saved(set: ProductImageSet) {
    library.setData(previous => [set, ...(previous ?? []).filter(item => item.id !== set.id)]);
    window.dispatchEvent(new CustomEvent('workbench:product-sets-changed'));
    setEditing(null); notify('产品图套已保存');
  }
  return <>
    <div className="toolbar product-set-toolbar">
      <label className="product-set-search"><span className="sr-only">搜索款号或名称</span><Icon name="search"/><input type="search" aria-label="搜索款号或名称" placeholder="搜索款号或名称" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <button className="primary" aria-label="新建产品图套" onClick={() => setEditing('new')}><Icon name="plus"/>新图套</button>
    </div>
    {library.error ? <Message error>{library.error}<button onClick={() => void library.refresh()}>重试</button></Message> : null}
    {library.loading ? <Message>正在读取图套…</Message> : visible.length ? <div className="product-set-grid">
      {visible.map(set => <article className="product-set-card" key={set.id}>
        <img className="product-set-cover" src={mediaUrl((set.media.find(media => media.role === 'product') ?? set.media[0]).id)} alt={`${set.styleNumber} 主商品图`} loading="lazy"/>
        <div className="product-set-card-copy"><h2>{set.styleNumber}</h2>{set.name ? <p>{set.name}</p> : null}<small>{set.media.length} 张图片</small></div>
        <div className="product-set-card-actions">
          <AsyncButton aria-label={`查看图套：${set.styleNumber}`} action={async () => setDetail(await api<ProductImageSet>(`/api/product-sets/${set.id}`))}>详情</AsyncButton>
          <AsyncButton aria-label={`修改图套：${set.styleNumber}`} action={async () => setEditing(await api<ProductImageSet>(`/api/product-sets/${set.id}`))}>修改</AsyncButton>
          <AsyncButton className="primary" aria-label={`使用图套：${set.styleNumber}`} action={() => useSet(set)}>使用<Icon name="arrow"/></AsyncButton>
        </div>
      </article>)}
    </div> : !library.error ? <Empty title={query ? '没有匹配的图套' : '暂无产品图套'}>{query ? <button onClick={() => setSearch('')}>清空搜索</button> : <button onClick={() => setEditing('new')}>新图套</button>}</Empty> : null}
    {editing ? <ProductSetEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onSaved={saved} onClose={() => setEditing(null)}/> : null}
    {detail ? <Modal title={`产品图套 · ${detail.styleNumber}`} onClose={() => setDetail(null)}>
      {detail.name ? <p>{detail.name}</p> : null}
      <div className="product-set-detail-grid">{detail.media.map((media, index) => <figure key={media.id}>
        <a href={mediaUrl(media.id)} target="_blank" rel="noreferrer" aria-label={`查看原图：${media.name}`}><img src={mediaUrl(media.id)} alt={media.name || `${detail.styleNumber} 图片 ${index + 1}`}/></a>
        <figcaption><strong>{roleLabels[media.role]}</strong><small>{media.name}</small></figcaption>
      </figure>)}</div>
      <div className="modal-footer"><button onClick={() => { setEditing(detail); setDetail(null); }}>修改</button><AsyncButton className="primary" aria-label={`使用图套：${detail.styleNumber}`} action={() => useSet(detail)}>使用<Icon name="arrow"/></AsyncButton></div>
    </Modal> : null}
  </>;
}
