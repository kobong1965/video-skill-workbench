import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { harness } from '../helpers';
import { buildApp } from '../../apps/api/app';

let h: Awaited<ReturnType<typeof harness>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let admin: Awaited<ReturnType<typeof h.account>>;
let member: typeof admin;
let source: string;
let mediaRoot: string;
let opened: string[] = [];
const male = randomUUID(); const female = randomUUID();
const payload = { generatedAt: '2026-10-31T12:00:00+08:00', products: [] as any[] };
async function save() { await writeFile(source, JSON.stringify(payload)); }
const sync = () => app.inject({ method: 'POST', url: '/api/product-catalog/sync', headers: admin.headers, payload: {} });
const get = () => app.inject({ url: '/api/product-catalog', headers: admin.headers });
const assetUrl = (uid: string, id: string) => `/api/product-catalog/${uid}/assets/${encodeURIComponent(id)}`;

beforeAll(async () => {
  h = await harness('catalog', 'http://127.0.0.1:4178', true); admin = await h.account('admin'); member = await h.account();
  mediaRoot = path.join(h.context.dataRoot, 'source-media'); source = path.join(h.context.dataRoot, 'source-catalog.json');
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(path.join(mediaRoot, 'image.png'), await sharp({ create: { width: 4, height: 4, channels: 3, background: '#777' } }).png().toBuffer());
  await writeFile(path.join(mediaRoot, 'clip.mp4'), Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]));
  payload.products = [male, female].map((uid, index) => ({ id: `${index ? 'women' : 'men'}:6121`, productUid: uid, category: index ? 'women' : 'men', sku: '6121', name: '裤子', title: '', sizes: ['S','M'], note: '原资料', coverId: `cover:${index}`, folders: [{ id: `folder:${index}`, label: '资料', path: mediaRoot }], assets: [{ id: `cover:${index}`, label: '主图', kind: 'main', path: path.join(mediaRoot, 'image.png') }, { id: `video:${index}`, label: '成片', kind: 'video', path: path.join(mediaRoot, 'clip.mp4') }], shopBindings: [{ shopName: index ? 'DEMA' : 'DEMOB', market: 'US', productId: index ? '9100000000000003001' : '9100000000000001001', productUrl: null, matchStatus: 'image_matched', evidence: [{ screenshot: 'binding-evidence/test.png', sha256: 'a'.repeat(64), row: 1 }] }] }));
  await save();
  app = await buildApp({ ...h.context, catalog: { sourcePath: source, allowedRoots: [mediaRoot], openFolder: async target => { opened.push(target); } } });
});
afterAll(async () => { await app?.close(); await h?.close(); });

describe('本机产品表单向同步', () => {
  it('首次读取为空且提示同步，不读取或改动生产产品表', async () => {
    const result = await get(); expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ products: [], syncedAt: null, counts: { products: 0 } });
  });
  it('按永久身份分开同款号，保留19位ID、空字段、图片视频和证据，原清单不变', async () => {
    const before = await readFile(source); const result = await sync(); expect(result.statusCode).toBe(200);
    const snapshot = result.json(); expect(snapshot.stale).toBe(false);
    expect(snapshot.counts).toEqual({ products: 2, men: 1, women: 1, images: 2, videos: 2, folders: 2 });
    expect(snapshot.products.map((p: any) => p.productUid)).toEqual([male, female]);
    expect(snapshot.products[0].shopBindings[0].productId).toBe('9100000000000001001');
    expect(snapshot.products[0].title).toBe(''); expect(snapshot.products[0].shopBindings[0].productUrl).toBeNull();
    expect(snapshot.products[0].assets[0]).toMatchObject({ available: true, mediaType: 'image' });
    expect(JSON.stringify(snapshot)).not.toContain(mediaRoot); expect(await readFile(source)).toEqual(before);
  });
  it('重复同步幂等，重启后能读回；不改既有图套、任务或媒体', async () => {
    const response = await get(); expect(response.statusCode).toBe(200);
    const before = response.json(); expect(before.products).toHaveLength(2);
    const synced = await sync(); expect(synced.statusCode).toBe(200); const again = synced.json();
    expect(again.products).toEqual(before.products); expect(again.sourceHash).toBe(before.sourceHash);
    const restarted = await buildApp({ ...h.context, catalog: { sourcePath: source, allowedRoots: [mediaRoot] } } as any);
    try { expect((await restarted.inject({ url: '/api/product-catalog', headers: admin.headers })).json().products).toEqual(before.products); } finally { await restarted.close(); }
    for (const table of ['product_sets', 'tasks', 'media']) expect(Number((await h.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count)).toBe(0);
  });
  it('身份冲突、数字ID失精度或非法路径不覆盖上一份镜像', async () => {
    const original = structuredClone(payload.products);
    for (const mutate of [() => { payload.products[1].productUid = male; }, () => { payload.products[0].shopBindings[0].productId = 9100000000000001001; }, () => { payload.products[0].assets[0].path = path.join(h.context.dataRoot, 'local-secrets.json'); }]) {
      mutate(); await save(); const result = (await sync()).json(); expect(result.stale).toBe(true); expect(result.products).toHaveLength(2); expect(result.error).toBeTruthy(); payload.products = structuredClone(original);
    }
    await save(); await sync();
  });
  it('源损坏与丢失保留旧快照并明确同步失败', async () => {
    await writeFile(source, '{invalid'); expect((await sync()).json()).toMatchObject({ stale: true, products: expect.any(Array) });
    await rename(source, `${source}.away`); expect((await sync()).json().products).toHaveLength(2);
    await rename(`${source}.away`, source); await save(); await sync();
  });
  it('源移除条目只标记来源缺失，后续恢复沿用原产品身份', async () => {
    const item = payload.products.pop(); await save(); const missing = (await sync()).json();
    expect(missing.products.find((p: any) => p.productUid === female).sourceMissing).toBe(true);
    payload.products.push(item); await save(); expect((await sync()).json().products.find((p: any) => p.productUid === female).sourceMissing).toBe(false);
  });
  it('所有入口拒绝未登录、成员、远程、非单人模式及无CSRF写入', async () => {
    const endpoints = [{ url: '/api/product-catalog', method: 'GET' }, { url: '/api/product-catalog/sync', method: 'POST' }, { url: assetUrl(male, 'cover:0'), method: 'GET' }, { url: `/api/product-catalog/${male}/folders/folder%3A0/open`, method: 'POST' }];
    for (const endpoint of endpoints) {
      expect((await app.inject({ ...endpoint, method: endpoint.method as any, headers: { origin: h.context.origin } })).statusCode).toBe(401);
      expect((await app.inject({ ...endpoint, method: endpoint.method as any, headers: member.headers })).statusCode).toBe(403);
      expect((await app.inject({ ...endpoint, method: endpoint.method as any, headers: admin.headers, remoteAddress: '192.168.1.20' })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/api/product-catalog/sync', headers: { ...admin.headers, 'x-csrf-token': '' } })).statusCode).toBe(403);
    const shared = await buildApp({ ...h.context, singleUserMode: false });
    try { expect((await shared.inject({ url: '/api/product-catalog', headers: admin.headers })).statusCode).toBe(403); } finally { await shared.close(); }
  });
  it('仅能读取已登记媒体，视频支持合法范围，非法范围返回416', async () => {
    expect((await app.inject({ url: assetUrl(male, 'cover:0'), headers: admin.headers })).headers['content-type']).toContain('image/png');
    const video = await app.inject({ url: assetUrl(male, 'video:0'), headers: { ...admin.headers, range: 'bytes=4-7' } });
    expect(video.statusCode).toBe(206); expect(video.body).toBe('ftyp'); expect(video.headers['content-range']).toBe('bytes 4-7/24');
    expect((await app.inject({ url: assetUrl(male, 'video:0'), headers: { ...admin.headers, range: 'bytes=999-' } })).statusCode).toBe(416);
    expect((await app.inject({ url: assetUrl(male, '../local-secrets.json'), headers: admin.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: assetUrl(female, 'cover:0'), headers: admin.headers })).statusCode).toBe(404);
  });
  it('目录打开只接受登记ID，不能注入路径或命令', async () => {
    opened = []; const result = await app.inject({ method: 'POST', url: `/api/product-catalog/${male}/folders/folder%3A0/open`, headers: admin.headers, payload: {} });
    expect(result.statusCode).toBe(200); expect(opened).toEqual([await import('node:fs/promises').then(fs => fs.realpath(mediaRoot))]);
    expect((await app.inject({ method: 'POST', url: `/api/product-catalog/${male}/folders/bad/open`, headers: admin.headers, payload: { path: 'C:\\Windows' } })).statusCode).toBe(404);
    expect(opened).toHaveLength(1);
  });
  it('缺图仅显示不可用；伪装成图片的文件不能被媒体接口读取', async () => {
    await rename(path.join(mediaRoot, 'image.png'), path.join(mediaRoot, 'image.good'));
    expect((await get()).json().products[0].assets[0].available).toBe(false);
    expect((await app.inject({ url: assetUrl(male, 'cover:0'), headers: admin.headers })).statusCode).toBe(404);
    await writeFile(path.join(mediaRoot, 'image.png'), '<html>secret</html>');
    expect((await app.inject({ url: assetUrl(male, 'cover:0'), headers: admin.headers })).statusCode).toBe(404);
    await rename(path.join(mediaRoot, 'image.png'), path.join(mediaRoot, 'image.fake'));
    await rename(path.join(mediaRoot, 'image.good'), path.join(mediaRoot, 'image.png'));
  });
});
