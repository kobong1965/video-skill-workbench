import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { z } from 'zod';
import type { CatalogSnapshot, CatalogProduct } from '../../packages/contracts/product-catalog';
import { catalogProductSchema, sourceCatalogSchema, validateIdentities, type SourceProduct } from './product-catalog-schema';

export const CATALOG_SOURCE = 'E:\\Codex工作盘\\artifacts\\latest\\美区产品表-0.1.0\\resources\\app\\data\\catalog.json';
const DEFAULT_ROOTS = [
  'D:\\桌面\\美区产品图片', 'D:\\桌面\\美区女装牛仔裤视频_按款号_20261026',
  'E:\\Codex工作盘\\artifacts\\latest\\好品源_新增10款_主图与详情页_20261026',
  'E:\\Codex工作盘\\artifacts\\latest\\好品源_主图与详情页_重新生图_20261026',
];
export interface ProductCatalogOptions { sourcePath?: string; allowedRoots?: string[]; openFolder?: (target: string) => Promise<void>; }
const pinnedProductSchema = catalogProductSchema.extend({
  sourceMissing: z.boolean(),
  assetPins: z.record(z.string(), z.string().nullable()), folderPins: z.record(z.string(), z.string().nullable()),
});
const mirrorSchema = z.object({
  schemaVersion: z.literal(1), syncedAt: z.string(), sourceUpdatedAt: z.string(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  products: z.array(pinnedProductSchema).max(10000),
});
const syncStatusSchema = z.object({ failed: z.boolean(), at: z.string() });
const SYNC_ERROR = '同步未完成：来源缺失、格式不正确或正被同步。已保留上一份有效资料，未改动原文件。';
const syncQueues = new Map<string, Promise<void>>();
type PinnedProduct = z.infer<typeof pinnedProductSchema>;
type Mirror = z.infer<typeof mirrorSchema>;
const MEDIA: Record<string, { type: 'image' | 'video'; mime: string }> = {
  '.png': { type: 'image', mime: 'image/png' }, '.jpg': { type: 'image', mime: 'image/jpeg' },
  '.jpeg': { type: 'image', mime: 'image/jpeg' }, '.webp': { type: 'image', mime: 'image/webp' },
  '.gif': { type: 'image', mime: 'image/gif' }, '.mp4': { type: 'video', mime: 'video/mp4' },
  '.mov': { type: 'video', mime: 'video/quicktime' }, '.m4v': { type: 'video', mime: 'video/mp4' },
};
const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
function inside(root: string, target: string) {
  const relative = path.relative(root, target); return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function cleanAbsolute(value: string) {
  if (!path.isAbsolute(value) || /[\x00-\x1f]/.test(value) || value.split(/[\\/]/).includes('..') || value.startsWith('\\\\') || value.startsWith('//')) throw new Error('catalog_invalid_path');
  if (process.platform === 'win32' && /:/.test(value.slice(2))) throw new Error('catalog_invalid_stream');
  return path.resolve(value);
}
async function readJson(file: string) {
  const info = await stat(file); if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new Error('catalog_invalid_size');
  return readFile(file, 'utf8');
}
async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`; const handle = await open(temporary, 'wx');
  try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } finally { await unlink(temporary).catch(() => {}); }
}
async function acquireSyncLock(directory: string): Promise<FileHandle> {
  const lockPath = path.join(directory, 'sync.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() })); await handle.sync(); return handle; }
      catch (error) { await handle.close(); await unlink(lockPath).catch(() => {}); throw error; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const before = await stat(lockPath), raw = await readJson(lockPath);
      let abandoned = false;
      try {
        const record = JSON.parse(raw) as { pid?: unknown };
        if (!Number.isSafeInteger(record.pid) || Number(record.pid) <= 0) throw new Error('invalid_lock');
        try { process.kill(Number(record.pid), 0); } catch (probe) { abandoned = (probe as NodeJS.ErrnoException).code === 'ESRCH'; }
      } catch { abandoned = Date.now() - before.mtimeMs > 120_000; }
      // Never reclaim a live writer or a just-created (not yet populated) lock.
      if (!abandoned || raw !== await readJson(lockPath)) throw new Error('catalog_sync_busy');
      const after = await stat(lockPath);
      if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) throw new Error('catalog_lock_changed');
      await unlink(lockPath);
    }
  }
  throw new Error('catalog_sync_busy');
}
function validSignature(bytes: Buffer, extension: string) {
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === '.webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  return bytes.toString('ascii', 4, 8) === 'ftyp';
}

/** Stores only a local mirror. The authoritative catalogue and its media are never changed. */
export class ProductCatalogStore {
  private readonly directory: string;
  private readonly roots: string[];
  private readonly source: string;
  private mirror: Mirror | null = null;
  private loadPromise: Promise<void> | null = null;
  private error: string | null = null;
  constructor(dataRoot: string, options: ProductCatalogOptions = {}) {
    this.directory = path.join(dataRoot, 'catalog-mirror'); this.source = options.sourcePath ?? CATALOG_SOURCE;
    this.roots = (options.allowedRoots ?? DEFAULT_ROOTS).map(cleanAbsolute);
  }
  private registeredPath(value: string) {
    const resolved = cleanAbsolute(value);
    if (!this.roots.some(root => inside(root, resolved))) throw new Error('catalog_path_not_allowed');
    return resolved;
  }
  private validateProduct(product: SourceProduct) {
    for (const folder of product.folders) this.registeredPath(folder.path);
    for (const asset of product.assets) {
      const file = this.registeredPath(asset.path), media = MEDIA[path.extname(file).toLowerCase()];
      if (!media || (asset.kind === 'video') !== (media.type === 'video') || !product.folders.some(folder => inside(path.resolve(folder.path), file))) throw new Error('catalog_invalid_media');
    }
  }
  private async canonical(value: string, kind: 'file' | 'folder'): Promise<string | null> {
    const resolved = this.registeredPath(value);
    try {
      const target = await realpath(resolved), info = await stat(target);
      if (!(kind === 'file' ? info.isFile() : info.isDirectory())) return null;
      // This catalogue registers concrete original files, never junction/symlink aliases.
      // A later sync must not silently legitimise a redirected directory or asset.
      if (!samePath(resolved, target)) return null;
      for (const root of this.roots.filter(candidate => inside(candidate, resolved))) {
        const canonicalRoot = await realpath(root);
        // A junction cannot redirect the configured trust boundary elsewhere.
        if (samePath(root, canonicalRoot) && inside(canonicalRoot, target)) return target;
      }
    } catch { return null; }
    return null;
  }
  private async pin(product: SourceProduct): Promise<PinnedProduct> {
    this.validateProduct(product);
    const folderPins: Record<string, string | null> = Object.create(null), assetPins: Record<string, string | null> = Object.create(null);
    for (const folder of product.folders) folderPins[folder.id] = await this.canonical(folder.path, 'folder');
    for (const asset of product.assets) {
      const target = await this.canonical(asset.path, 'file');
      assetPins[asset.id] = target && product.folders.some(folder => folderPins[folder.id] && inside(folderPins[folder.id]!, target)) ? target : null;
    }
    return { ...product, sourceMissing: false, folderPins, assetPins };
  }
  private load() {
    return this.loadPromise ??= this.loadFromDisk();
  }
  private async loadFromDisk() {
    for (const name of ['snapshot.json', 'last-good.json']) {
      try {
        const candidate = mirrorSchema.parse(JSON.parse(await readJson(path.join(this.directory, name))));
        validateIdentities(candidate.products); candidate.products.forEach(product => this.validateProduct(product));
        this.mirror = candidate; if (name === 'last-good.json') this.error = '当前镜像损坏，已恢复上一份有效资料，请重新同步。';
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = '本机镜像暂时无法读取，请重新同步；原资料未改动。';
      }
    }
    try {
      const status = syncStatusSchema.parse(JSON.parse(await readJson(path.join(this.directory, 'sync-status.json'))));
      if (status.failed) this.error = SYNC_ERROR;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = '同步状态无法读取，请重新同步；已有资料已保留。';
    }
  }
  async sync(): Promise<CatalogSnapshot> {
    const previous = syncQueues.get(this.directory) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    syncQueues.set(this.directory, pending);
    await previous;
    try { return await this.performSync(); }
    finally { release(); if (syncQueues.get(this.directory) === pending) syncQueues.delete(this.directory); }
  }
  private async performSync(): Promise<CatalogSnapshot> {
    await this.load(); await mkdir(this.directory, { recursive: true });
    let lock: FileHandle | undefined;
    try {
      lock = await acquireSyncLock(this.directory);
      const raw = await readJson(this.source), parsed = sourceCatalogSchema.parse(JSON.parse(raw));
      validateIdentities(parsed.products);
      const products: PinnedProduct[] = [];
      for (const product of parsed.products) products.push(await this.pin(product));
      const currentIds = new Set(products.map(product => product.productUid));
      for (const previous of this.mirror?.products ?? []) if (!currentIds.has(previous.productUid)) products.push({ ...previous, sourceMissing: true });
      validateIdentities(products);
      const next: Mirror = { schemaVersion: 1, syncedAt: new Date().toISOString(), sourceUpdatedAt: parsed.generatedAt, sourceHash: createHash('sha256').update(raw).digest('hex'), products };
      if (this.mirror) await atomicJson(path.join(this.directory, 'last-good.json'), this.mirror);
      await atomicJson(path.join(this.directory, 'snapshot.json'), next);
      await atomicJson(path.join(this.directory, 'sync-status.json'), { failed: false, at: next.syncedAt });
      this.mirror = next; this.error = null;
    } catch {
      this.error = SYNC_ERROR;
      if (lock) await atomicJson(path.join(this.directory, 'sync-status.json'), { failed: true, at: new Date().toISOString() }).catch(() => {});
    } finally {
      if (lock) { await lock.close(); await unlink(path.join(this.directory, 'sync.lock')).catch(() => {}); }
    }
    return this.snapshot();
  }
  private async available(value: string, pin: string | null | undefined, kind: 'file' | 'folder') {
    if (!pin) return false; const current = await this.canonical(value, kind); return !!current && samePath(current, pin);
  }
  async snapshot(): Promise<CatalogSnapshot> {
    await this.load(); const products: CatalogProduct[] = [];
    for (const product of this.mirror?.products ?? []) {
      const { assetPins, folderPins, assets, folders, ...publicProduct } = product;
      products.push({ ...publicProduct,
        folders: await Promise.all(folders.map(async folder => ({ id: folder.id, label: folder.label, available: await this.available(folder.path, folderPins[folder.id], 'folder') }))),
        assets: await Promise.all(assets.map(async asset => ({ id: asset.id, label: asset.label, kind: asset.kind, available: await this.available(asset.path, assetPins[asset.id], 'file'), mediaType: MEDIA[path.extname(asset.path).toLowerCase()].type, url: `/api/product-catalog/${encodeURIComponent(product.productUid)}/assets/${encodeURIComponent(asset.id)}` }))),
      });
    }
    return { products, syncedAt: this.mirror?.syncedAt ?? null, sourceUpdatedAt: this.mirror?.sourceUpdatedAt ?? null, sourceHash: this.mirror?.sourceHash ?? null,
      stale: !!this.error, error: this.error, sourceLabel: '美区产品表（本机只读来源）',
      counts: { products: products.length, men: products.filter(product => product.category === 'men').length, women: products.filter(product => product.category === 'women').length,
        images: products.reduce((count, product) => count + product.assets.filter(asset => asset.mediaType === 'image').length, 0),
        videos: products.reduce((count, product) => count + product.assets.filter(asset => asset.mediaType === 'video').length, 0),
        folders: products.reduce((count, product) => count + product.folders.length, 0) } };
  }
  async asset(productUid: string, assetId: string) {
    await this.load(); const product = this.mirror?.products.find(item => item.productUid === productUid), asset = product?.assets.find(item => item.id === assetId);
    if (!product || !asset || !await this.available(asset.path, product.assetPins[asset.id], 'file')) return null;
    const target = product.assetPins[asset.id]!, extension = path.extname(asset.path).toLowerCase();
    let handle: FileHandle | undefined;
    try {
      handle = await open(target, 'r'); const info = await handle.stat(), currentInfo = await stat(target);
      if (!info.isFile() || info.ino !== currentInfo.ino || info.dev !== currentInfo.dev || !await this.available(asset.path, target, 'file')) throw new Error('catalog_media_changed');
      const signature = Buffer.alloc(16); const { bytesRead } = await handle.read(signature, 0, 16, 0);
      if (!validSignature(signature.subarray(0, bytesRead), extension)) throw new Error('catalog_invalid_signature');
      return { handle, size: info.size, mime: MEDIA[extension].mime };
    } catch { await handle?.close(); return null; }
  }
  async folder(productUid: string, folderId: string): Promise<string | null> {
    await this.load(); const product = this.mirror?.products.find(item => item.productUid === productUid), folder = product?.folders.find(item => item.id === folderId);
    if (!product || !folder || !await this.available(folder.path, product.folderPins[folder.id], 'folder')) return null;
    return product.folderPins[folder.id];
  }
}
