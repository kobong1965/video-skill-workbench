import { useRef, useState } from 'react';
import type { CatalogAsset, CatalogProduct } from '../../../../packages/contracts/product-catalog';
import { Icon, Message, Modal } from '../ui';
import { assetLabels } from './presentation';

export function CatalogImage({ asset, alt, className = '' }: { asset?: CatalogAsset; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!asset || !asset.available || failed) return <span className={`catalog-image-missing ${className}`}><Icon name="image"/><span>{asset ? '原文件不可用' : '暂无图片'}</span></span>;
  return <img className={className} src={asset.url} alt={alt} loading="lazy" onError={() => setFailed(true)}/>;
}

function CatalogVideo({ asset }: { asset: CatalogAsset }) {
  const [failed, setFailed] = useState(false);
  return <div className="catalog-video">{!asset.available ? <span className="catalog-image-missing"><Icon name="play"/>原文件不可用</span> : failed ? <Message error>视频暂时无法播放，请检查原文件，恢复后点击“同步产品资料”重试。</Message> : <video aria-label={asset.label} src={asset.url} controls preload="none" onError={() => setFailed(true)}/>}</div>;
}

export function CatalogMedia({ product, revision }: { product: CatalogProduct; revision: number }) {
  const [kind, setKind] = useState<CatalogAsset['kind']>(product.assets.find(asset => asset.kind === 'main')?.kind ?? product.assets[0]?.kind ?? 'main');
  const [assetId, setAssetId] = useState('');
  const [preview, setPreview] = useState<CatalogAsset | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  function closePreview() { setPreview(null); requestAnimationFrame(() => previewTrigger.current?.focus()); }
  const assets = product.assets.filter(asset => asset.kind === kind);
  const selected = assets.find(asset => asset.id === assetId) ?? assets[0];
  return <section className="catalog-media" aria-label="商品素材">
    <h3>商品素材</h3>
    <div className="catalog-media-kinds" aria-label="素材分类">{(Object.keys(assetLabels) as CatalogAsset['kind'][]).map(value => <button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setAssetId(''); }}>{assetLabels[value]} <span>{product.assets.filter(asset => asset.kind === value).length}</span></button>)}</div>
    {!selected ? <div className="catalog-no-media">该分类暂无素材</div> : <>
      {selected.mediaType === 'video' ? <CatalogVideo key={`${selected.id}:${revision}`} asset={selected}/> : <button ref={previewTrigger} className="catalog-main-image" aria-label={`预览原图：${selected.label}`} disabled={!selected.available} onClick={() => setPreview(selected)}><CatalogImage key={`${selected.url}:${revision}`} asset={selected} alt={selected.label}/>{selected.available ? <span className="catalog-preview-hint">查看原图 <Icon name="arrow"/></span> : null}</button>}
      <p className="catalog-media-label">{selected.label}</p>
      {assets.length > 1 ? <div className="catalog-thumbnails" aria-label={`${assetLabels[kind]}列表`}>{assets.map(asset => <button key={asset.id} aria-label={`选择素材：${asset.label}`} aria-pressed={selected.id === asset.id} onClick={() => setAssetId(asset.id)}>{asset.mediaType === 'video' ? <Icon name="play"/> : <CatalogImage key={`${asset.url}:${revision}`} asset={asset} alt=""/>}<span>{asset.label}</span></button>)}</div> : null}
    </>}
    {preview ? <Modal title={preview.label} onClose={closePreview}><div className="catalog-original"><CatalogImage key={`${preview.url}:${revision}`} asset={preview} alt={preview.label}/></div><p className="muted">只读预览原文件，不会改写或上传图片。</p></Modal> : null}
  </section>;
}
