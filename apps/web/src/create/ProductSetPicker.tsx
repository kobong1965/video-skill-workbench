import { useEffect, useRef, useState } from 'react';
import { MAX_PRODUCT_GROUPS, MAX_TASK_IMAGES, type ProductImageSet } from '../../../../packages/contracts';
import { api, mediaUrl } from '../api';
import { useLoad } from '../workspace';
import { Empty, Icon, Message, Modal } from '../ui';
import './product-set-picker.css';

export function ProductSetPicker({ initialIds = [], onChoose, onClose }: { initialIds?: string[]; onChoose: (sets: ProductImageSet[]) => void; onClose: () => void }) {
  const sets = useLoad<ProductImageSet[]>('/api/product-sets');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    active.current = true;
    const invalidate = () => { active.current = false; closeHandler.current(); };
    window.addEventListener('hashchange', invalidate);
    return () => { active.current = false; window.removeEventListener('hashchange', invalidate); };
  }, []);
  const term = query.trim().toLocaleLowerCase();
  const byId = new Map(sets.data?.map(set => [set.id, set]));
  const selected = selectedIds.map(id => byId.get(id));
  const count = new Set(selected.flatMap(set => set?.media.map(file => file.id) ?? [])).size;
  const visible = sets.data?.filter(set => `${set.styleNumber} ${set.name}`.toLocaleLowerCase().includes(term)) ?? [];

  function toggle(id: string) {
    if (selecting) return;
    setError('');
    if (selectedIds.includes(id)) { setSelectedIds(ids => ids.filter(value => value !== id)); return; }
    if (selectedIds.length >= MAX_PRODUCT_GROUPS) { setError(`最多选择 ${MAX_PRODUCT_GROUPS} 个款号`); return; }
    const images = new Set([...selectedIds, id].flatMap(value => byId.get(value)?.media.map(file => file.id) ?? []));
    if (images.size > MAX_TASK_IMAGES) { setError(`所选图套共 ${images.size} 张图，最多支持 ${MAX_TASK_IMAGES} 张，请减少图套`); return; }
    setSelectedIds(ids => [...ids, id]);
  }
  function move(index: number, direction: number) {
    setSelectedIds(ids => { const next = [...ids]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  function close() { active.current = false; onClose(); }
  async function choose() {
    if (selecting || !selectedIds.length) return;
    const route = location.hash;
    setSelecting(true); setError('');
    try {
      const latest = await Promise.all(selectedIds.map(id => api<ProductImageSet>(`/api/product-sets/${id}`)));
      const total = new Set(latest.flatMap(set => set.media.map(file => file.id))).size;
      if (total > MAX_TASK_IMAGES) throw new Error(`图套已更新，现有 ${total} 张图，超过 ${MAX_TASK_IMAGES} 张；请调整选择，不会删图`);
      if (active.current && location.hash === route) onChoose(latest);
    } catch (failure) { if (active.current) setError((failure as Error).message); }
    finally { if (active.current) setSelecting(false); }
  }

  return <Modal title="选择款号" onClose={close}>
    <label className="product-set-picker-search">款号<input type="search" aria-label="搜索款号" placeholder="款号或商品名称" value={query} disabled={selecting} onChange={event => setQuery(event.target.value)}/></label>
    {sets.error || error ? <Message error>{sets.error || error}{sets.error ? <button onClick={() => void sets.refresh()}>重试</button> : null}</Message> : null}
    {sets.loading ? <Message>正在读取图套…</Message> : visible.length ? <div className="product-set-choice-grid">
      {visible.map(set => {
        const cover = set.media.find(file => file.role === 'product') ?? set.media[0];
        const order = selectedIds.indexOf(set.id);
        return <button key={set.id} className={`product-set-choice${order >= 0 ? ' selected' : ''}`} disabled={selecting} aria-label={`选择款号：${set.styleNumber}`} aria-pressed={order >= 0} onClick={() => toggle(set.id)}>
          {cover ? <img src={mediaUrl(cover.id)} alt="" loading="lazy"/> : <Icon name="image"/>}
          {order >= 0 ? <span className="product-set-order" aria-label={`已选第 ${order + 1} 组`}>{order + 1}<Icon name="check"/></span> : null}
          <strong>{set.styleNumber}</strong>
          {set.name ? <span>{set.name}</span> : null}
          <small>{set.media.length} 张</small>
        </button>;
      })}
    </div> : <Empty title={term ? '没有匹配的款号' : '暂无产品图套'}><p>{term ? '请换一个款号或名称。' : '可在素材页保存款号和产品图片。'}</p></Empty>}
    {selectedIds.length ? <ol className="product-set-selected-order" aria-label="已选款号">{selectedIds.map((id, index) => {
      const label = byId.get(id)?.styleNumber ?? '已不可用的图套';
      return <li key={id}><span><b>{index + 1}</b>{label}</span><div className="inline">
        <button type="button" aria-label={`上移款号：${label}`} disabled={selecting || index === 0} onClick={() => move(index, -1)}>↑</button>
        <button type="button" aria-label={`下移款号：${label}`} disabled={selecting || index === selectedIds.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button type="button" aria-label={`移除款号：${label}`} disabled={selecting} onClick={() => toggle(id)}><Icon name="close"/></button>
      </div></li>;
    })}</ol> : null}
    <div className="modal-footer product-set-picker-footer"><span role="status">{selectedIds.length} / {MAX_PRODUCT_GROUPS} 套 · {count} / {MAX_TASK_IMAGES} 张</span><button type="button" onClick={close}>取消</button><button type="button" className="primary" aria-label="使用所选款号" disabled={selecting || !selectedIds.length || sets.loading} aria-busy={selecting || undefined} onClick={() => void choose()}>{selecting ? '载入中' : '使用'}</button></div>
  </Modal>;
}
