import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Database } from '../../packages/storage/database';
import { transaction } from '../../packages/storage/database';
import { inspectMedia } from '../../packages/storage/private-files';
import { catalogBindingSchema, catalogSelectionSnapshotSchema, type CatalogSelection, type CatalogSelectionSnapshot } from '../../packages/contracts/catalog-selection';
import { AppError, type AppContext } from './context';
import type { ProductCatalogStore } from './product-catalog-store';

export const catalogSelectionInput = z.object({
  productUid: z.string().uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  binding: catalogBindingSchema.pick({ shopName: true, market: true, productId: true }),
  assetIds: z.array(z.string().min(1).max(200)).min(1).max(12),
}).strict().refine(value => new Set(value.assetIds).size === value.assetIds.length, '不能重复选择图片');

function dto(snapshot: CatalogSelectionSnapshot): CatalogSelection {
  return { id: snapshot.selectionId, source: 'catalog', styleNumber: snapshot.sku, name: snapshot.name.slice(0, 100),
    media: snapshot.assets.map(asset => ({ id: asset.mediaId, role: asset.role, name: asset.name })), catalog: snapshot,
    createdAt: snapshot.selectedAt, updatedAt: snapshot.selectedAt };
}
export async function ownedCatalogSelection(db: Database | PoolClient, id: string, ownerId: string): Promise<CatalogSelection> {
  const row = (await db.query('SELECT snapshot FROM product_catalog_selections WHERE id=$1 AND owner_id=$2', [id, ownerId])).rows[0];
  if (!row) throw new AppError(404, '产品表选款记录不存在或无权访问');
  const snapshot = catalogSelectionSnapshotSchema.parse(row.snapshot);
  const media = (await db.query('SELECT id,digest,mime FROM media WHERE owner_id=$1 AND id=ANY($2::uuid[])', [ownerId, snapshot.assets.map(asset => asset.mediaId)])).rows;
  if (media.length !== snapshot.assets.length || snapshot.assets.some(asset => !media.some(file => file.id === asset.mediaId && file.digest === asset.digest && file.mime.startsWith('image/')))) throw new AppError(409, '产品表选款图片已变化，请核对保存的资料');
  return dto(snapshot);
}

/** Copies only explicitly selected images after full validation, never the original files. */
export async function selectCatalogProduct(context: AppContext, store: ProductCatalogStore, ownerId: string, request: z.infer<typeof catalogSelectionInput>): Promise<CatalogSelection> {
  const source = await store.snapshot();
  if (source.stale || !source.sourceHash || source.sourceHash !== request.sourceHash || !source.sourceUpdatedAt) throw new AppError(409, '产品表同步状态或资料版本已变化，请先同步并重新选择');
  const product = source.products.find(product => product.productUid === request.productUid);
  if (!product || product.sourceMissing) throw new AppError(409, '产品来源已缺失，请同步产品表后重新选择');
  const matches = product.shopBindings.filter(binding => binding.shopName === request.binding.shopName && binding.market === request.binding.market && binding.productId === request.binding.productId);
  if (matches.length !== 1 || matches[0].matchStatus !== 'image_matched') throw new AppError(409, '店铺商品绑定不存在或尚待复核，请明确选择已确认的店铺和商品 ID');
  if (product.sku.length > 80) throw new AppError(409, '产品款号超过工作台支持长度，请先核对产品资料');
  const binding = catalogBindingSchema.parse(matches[0]);
  const chosen = request.assetIds.map(id => product.assets.find(asset => asset.id === id));
  if (chosen.some(asset => !asset || asset.kind === 'video')) throw new AppError(400, '所选图片不属于该款产品，或包含不支持的视频');
  if (!chosen.some(asset => asset!.kind === 'main')) throw new AppError(400, '产品表选款至少需要一张主图');
  const images: { assetId: string; kind: 'main' | 'detail' | 'reference'; role: 'product' | 'detail'; name: string; bytes: Buffer; mime: string; digest: string }[] = [];
  for (const asset of chosen) {
    const opened = await store.asset(product.productUid, asset!.id);
    if (!opened) throw new AppError(409, '产品图片缺失或已损坏，请重新同步核对');
    try {
      const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' } as Record<string, string>)[opened.mime];
      if (!extension || opened.size > 20 * 1024 * 1024) throw new AppError(409, '产品图片必须是 20 MB 以内的静态 PNG、JPG 或 WEBP');
      const bytes = await opened.handle.readFile();
      if (bytes.length !== opened.size) throw new AppError(409, '读取期间产品图片已变化，请重新选择');
      const name = `${product.sku}-${asset!.label}`.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 165) + extension;
      let mime: string;
      try { mime = await inspectMedia(name, bytes); } catch { throw new AppError(409, '产品图片无法完整解码，请先核对原图'); }
      images.push({ assetId: asset!.id, kind: asset!.kind as 'main' | 'detail' | 'reference', role: asset!.kind === 'main' ? 'product' : 'detail', name, bytes, mime, digest: createHash('sha256').update(bytes).digest('hex') });
    } finally { await opened.handle.close(); }
  }
  const afterRead = await store.snapshot();
  if (afterRead.stale || afterRead.sourceHash !== source.sourceHash) throw new AppError(409, '读取期间产品资料已同步更新，请重新选择');
  const selectionKey = createHash('sha256').update(JSON.stringify([product.productUid, binding, source.sourceHash, images.map(image => [image.assetId, image.digest])])).digest('hex');
  const created: { id: string; file: string }[] = [];
  try {
    return await transaction(context.db, async client => {
      // Same owner + selection serialize across processes, not just this HTTP instance.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`catalog:${ownerId}:${selectionKey}`]);
      const previous = (await client.query('SELECT snapshot FROM product_catalog_selections WHERE owner_id=$1 AND selection_key=$2', [ownerId, selectionKey])).rows[0];
      if (previous) return ownedCatalogSelection(client, previous.snapshot.selectionId, ownerId);
      const id = randomUUID(), selectedAt = new Date().toISOString();
      const assets: CatalogSelectionSnapshot['assets'] = [];
      const directory = path.join(context.dataRoot, 'media'); await mkdir(directory, { recursive: true });
      for (const image of images) {
        const mediaId = randomUUID(), diskPath = path.join('media', mediaId), file = path.join(context.dataRoot, diskPath);
        const handle = await open(file, 'wx', 0o600); created.push({ id: mediaId, file });
        try { await handle.writeFile(image.bytes); } finally { await handle.close(); }
        await client.query('INSERT INTO media(id,owner_id,name,mime,size,digest,disk_path) VALUES($1,$2,$3,$4,$5,$6,$7)', [mediaId, ownerId, image.name, image.mime, image.bytes.length, image.digest, diskPath]);
        assets.push({ assetId: image.assetId, mediaId, name: image.name, kind: image.kind, role: image.role, digest: image.digest });
      }
      const snapshot = catalogSelectionSnapshotSchema.parse({ selectionId: id, productUid: product.productUid, category: product.category, sku: product.sku, name: product.name, binding, sourceHash: source.sourceHash, sourceUpdatedAt: source.sourceUpdatedAt, selectedAt, assets });
      await client.query('INSERT INTO product_catalog_selections(id,owner_id,selection_key,product_uid,source_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6)', [id, ownerId, selectionKey, product.productUid, source.sourceHash, snapshot]);
      return dto(snapshot);
    });
  } catch (error) {
    // On an uncertain COMMIT keep files rather than risk destroying a saved selection.
    for (const item of created) {
      const exists = await context.db.query('SELECT id FROM media WHERE id=$1', [item.id]).catch(() => null);
      if (exists && !exists.rowCount) await unlink(item.file).catch(() => {});
    }
    throw error;
  }
}
