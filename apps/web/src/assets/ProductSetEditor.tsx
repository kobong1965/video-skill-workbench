import { useRef, useState } from 'react';
import type { ProductImageSet } from '../../../../packages/contracts';
import { api, mediaUrl, upload } from '../api';
import { FileDropzone } from '../uploads/FileDropzone';
import { uploadSequentially } from '../uploads/file-upload';
import { Icon, Message, Modal } from '../ui';

interface Props { initial?: ProductImageSet; onSaved: (value: ProductImageSet) => void; onClose: () => void; }

export function ProductSetEditor({ initial, onSaved, onClose }: Props) {
  const [styleNumber, setStyleNumber] = useState(initial?.styleNumber ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [media, setMedia] = useState<ProductImageSet['media']>(initial?.media ?? []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const pending = useRef(false);
  const hasProduct = media.some(item => item.role === 'product');
  const canSave = styleNumber.trim().length > 0 && hasProduct && !busy;
  async function addImages(files: File[]) {
    setBusy(true); setError('');
    try {
      const result = await uploadSequentially(files, upload, item => setMedia(previous => [...previous, { id: item.id, name: item.name, role: previous.length ? 'detail' : 'product' }]));
      if (result.failures.length) throw new Error(`已上传 ${result.succeeded} 张；未成功：${result.failures.join('；')}`);
    } finally { setBusy(false); }
  }
  async function save() {
    if (pending.current || !canSave) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const value = await api<ProductImageSet>(initial ? `/api/product-sets/${initial.id}` : '/api/product-sets', initial ? 'PUT' : 'POST', { styleNumber: styleNumber.trim(), name: name.trim(), media: media.map(({ id, role }) => ({ id, role })) });
      onSaved(value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存未成功，请重试'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title={initial ? '修改产品图套' : '新建产品图套'} onClose={() => { if (!busy) onClose(); }}>
    <form className="product-set-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="field-grid">
        <label>款号<input autoFocus required maxLength={80} autoComplete="off" value={styleNumber} disabled={busy} onChange={event => setStyleNumber(event.target.value)}/></label>
        <label>商品名称<input maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)}/></label>
      </div>
      <div className="product-set-image-grid">
        {media.map((item, index) => <div className="product-set-image" key={item.id}>
          <a href={mediaUrl(item.id)} target="_blank" rel="noreferrer" aria-label={`查看原图：${item.name}`}><img src={mediaUrl(item.id)} alt={item.name}/></a>
          <label><span className="sr-only">图套图片 {index + 1} 用途</span><select aria-label={`图套图片 ${index + 1} 用途`} value={item.role} disabled={busy} onChange={event => setMedia(previous => previous.map(value => value.id === item.id ? { ...value, role: event.target.value as typeof item.role } : value))}>
            <option value="product">主商品图</option><option value="detail">同款细节</option><option value="comparison">对比商品</option>
          </select></label>
          <button type="button" className="text-button" aria-label={`移除图套图片 ${index + 1}`} disabled={busy} onClick={() => setMedia(previous => previous.filter(value => value.id !== item.id))}>移除</button>
        </div>)}
      </div>
      <FileDropzone label={media.length ? '补充图片' : '上传图片'} inputLabel="上传图套图片" kind="image" multiple maxFiles={12 - media.length} disabled={busy || media.length >= 12} hint={`${media.length} / 12 张 · PNG / JPG / WEBP · 单张 ≤ 20 MB`} onFiles={addImages}/>
      {media.length && !hasProduct ? <Message error>至少保留一张主商品图。</Message> : null}
      {error ? <Message error>{error}</Message> : null}
      <div className="modal-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" aria-label="保存产品图套" aria-busy={busy || undefined} disabled={!canSave}><Icon name="save"/>{busy ? '处理中' : '保存'}</button></div>
    </form>
  </Modal>;
}
