import { useId, useState, type KeyboardEvent } from 'react';
import type { AssetInfo } from '../../../../packages/contracts';
import { api, upload, mediaUrl } from '../api';
import { useLoad, useWorkspace } from '../workspace';
import { FileDropzone } from '../uploads/FileDropzone';
import { AsyncButton, Empty, Message, Modal, kindLabel } from '../ui';
import { ProductSetLibrary } from './ProductSetLibrary';
import './product-sets.css';

export function AssetLibrary() {
  const [tab, setTab] = useState('products');
  const id = useId();
  const tabs = [{ id: 'products', name: '产品图套' }, { id: 'references', name: '参考图' }];
  function switchTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (index + 1) % 2 : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(tabs[next].id);
    document.getElementById(`${id}-${tabs[next].id}`)?.focus();
  }
  return <div className="asset-library">
    <div className="asset-library-tabs" role="tablist" aria-label="素材分类">
      {tabs.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`${id}-${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={event => switchTab(event, index)} onClick={() => setTab(item.id)}>{item.name}</button>)}
    </div>
    {tabs.map(item => <section key={item.id} role="tabpanel" aria-labelledby={`${id}-${item.id}`} id={`${id}-${item.id}-panel`} hidden={tab !== item.id}>
      {tab === item.id ? item.id === 'products' ? <ProductSetLibrary/> : <ReferenceLibrary/> : null}
    </section>)}
  </div>;
}

function ReferenceLibrary() {
  const assets = useLoad<AssetInfo[]>('/api/assets'); const { notify } = useWorkspace();
  const [uploading, setUploading] = useState(false); const [adding, setAdding] = useState(false); const [file, setFile] = useState<File | null>(null); const [name, setName] = useState(''); const [kind, setKind] = useState('person'); const [filter, setFilter] = useState('all');
  return <><div className="toolbar"><div className="inline"><select aria-label="筛选参考图类型" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部参考图</option>{['person', 'scene', 'angle', 'storyboard', 'tailframe'].map(x => <option value={x} key={x}>{kindLabel[x]}</option>)}</select><small>仅自己可见，选用前需确认</small></div><button className="primary" onClick={() => { setFile(null); setName(''); setAdding(true); }}>＋ 上传参考图</button></div>{assets.error ? <Message error>{assets.error}</Message> : null}{assets.loading ? <Message>正在读取参考图…</Message> : null}{assets.data?.length ? <div className="asset-grid">{assets.data.filter(x => filter === 'all' || x.kind === filter).map(asset => <article className="asset-card" key={asset.id}><a href={mediaUrl(asset.mediaId)} target="_blank" rel="noreferrer"><img src={mediaUrl(asset.mediaId)} alt={asset.name}/></a><h3>{asset.name}</h3><div className="tags"><span className="tag gray">{kindLabel[asset.kind]}</span><span className="tag blue">{asset.confirmed ? '已确认' : '待确认'}</span></div><div className="inline section-space">{!asset.confirmed ? <AsyncButton action={async () => { await api(`/api/assets/${asset.id}/confirm`, 'POST', {}); await assets.refresh(); notify('参考图已确认，可在任务中选用'); }}>确认这张图</AsyncButton> : null}<a href={mediaUrl(asset.mediaId)} download={asset.name}>下载原图 ↗</a></div></article>)}</div> : !assets.loading ? <Empty title="人物和场景，可以留着下次用"><p>上传已有参考图，或在提示词确认后按需生成。这里不会自动发起生图。</p></Empty> : null}
  {adding ? <Modal title="上传已有参考图" onClose={() => { if (!uploading) setAdding(false); }}><div className="form-stack"><FileDropzone label="选择图片" kind="image" disabled={uploading} onFiles={files => { setFile(files[0]); setName(files[0].name.replace(/\.[^.]+$/, '')); }}/><label>参考图名称<input value={name} disabled={uploading} onChange={e => setName(e.target.value)}/></label><label>用途<select value={kind} disabled={uploading} onChange={e => setKind(e.target.value)}>{['person', 'scene', 'angle', 'storyboard'].map(x => <option value={x} key={x}>{kindLabel[x]}</option>)}</select></label><small>上传后仍需查看并确认，不会自动绑定任务。</small><AsyncButton className="primary" disabled={!file || !name.trim()} action={async () => { if (!file) return; setUploading(true); try { const media = await upload(file); await api('/api/assets', 'POST', { mediaId: media.id, name, kind }); await assets.refresh(); setAdding(false); setFile(null); notify('图片已上传，请查看后确认'); } finally { setUploading(false); } }}>上传参考图</AsyncButton></div></Modal> : null}</>;
}
