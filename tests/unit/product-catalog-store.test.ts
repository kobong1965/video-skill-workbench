import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProductCatalogStore } from '../../apps/api/product-catalog-store';

async function fixture() {
  const root = path.join(process.env.VSW_TEST_ROOT!, `catalog-store-${randomUUID()}`), media = path.join(root, 'media'), folder = path.join(media, 'product');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'main.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const source = path.join(root, 'catalog.json');
  const product = { id: 'men:6121', productUid: randomUUID(), category: 'men', sku: '6121', name: '裤子', title: '', sizes: [], note: '', coverId: 'main',
    folders: [{ id: 'folder', label: '原资料', path: folder }], assets: [{ id: 'main', label: '主图', kind: 'main', path: path.join(folder, 'main.png') }], shopBindings: [] };
  await writeFile(source, JSON.stringify({ generatedAt: '2026-10-31', products: [product] }));
  const options = { sourcePath: source, allowedRoots: [media] };
  const store = new ProductCatalogStore(root, options); expect((await store.sync()).products).toHaveLength(1);
  return { root, media, folder, source, product, store, options };
}

describe('产品表镜像中断恢复及路径保护', () => {
  it('进程中断遗留锁恢复后可以再次同步，不丢已有快照', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'catalog-mirror', 'sync.lock'), JSON.stringify({ pid: 2147483646, token: randomUUID() }));
    const restarted = new ProductCatalogStore(f.root, f.options);
    const result = await restarted.sync(); expect(result.stale).toBe(false); expect(result.products).toHaveLength(1);
  });
  it('首次并发读取都会等到已有镜像加载完成', async () => {
    const f = await fixture(), restarted = new ProductCatalogStore(f.root, f.options);
    const [left, right] = await Promise.all([restarted.snapshot(), restarted.snapshot()]);
    expect(left.products).toHaveLength(1); expect(right.products).toHaveLength(1);
  });
  it('目录联接漂移后，登记媒体与目录均不能指向别处', async () => {
    const f = await fixture(), alternate = path.join(f.media, 'alternate');
    await mkdir(alternate); await writeFile(path.join(alternate, 'main.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await rename(f.folder, `${f.folder}-saved`); await symlink(alternate, f.folder, process.platform === 'win32' ? 'junction' : 'dir');
    const snapshot = await f.store.snapshot(); expect(snapshot.products[0].assets[0].available).toBe(false); expect(snapshot.products[0].folders[0].available).toBe(false);
    expect(await f.store.asset(f.product.productUid, 'main')).toBeNull(); expect(await f.store.folder(f.product.productUid, 'folder')).toBeNull();
    const synced = await f.store.sync(); expect(synced.products[0].assets[0].available).toBe(false); expect(synced.products[0].folders[0].available).toBe(false);
  });
  it('镜像损坏后恢复last-good，且不会读出路径', async () => {
    const f = await fixture(); await f.store.sync();
    await writeFile(path.join(f.root, 'catalog-mirror', 'snapshot.json'), '{broken');
    const snapshot = await new ProductCatalogStore(f.root, f.options).snapshot();
    expect(snapshot.products).toHaveLength(1); expect(snapshot.stale).toBe(true); expect(JSON.stringify(snapshot)).not.toContain(f.media);
  });
  it('失败后的重启仍显示未同步，直到下一次来源成功同步', async () => {
    const f = await fixture(); await rename(f.source, `${f.source}.saved`);
    expect((await f.store.sync()).stale).toBe(true);
    const restarted = new ProductCatalogStore(f.root, f.options);
    expect((await restarted.snapshot()).stale).toBe(true);
    await rename(`${f.source}.saved`, f.source);
    expect((await restarted.sync()).stale).toBe(false);
    expect((await new ProductCatalogStore(f.root, f.options).snapshot()).stale).toBe(false);
  });
});
