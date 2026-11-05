import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { harness } from '../helpers';
import { buildApp } from '../../apps/api/app';
import { createDatabase } from '../../packages/storage/database';

let h: Awaited<ReturnType<typeof harness>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let owner: Awaited<ReturnType<typeof h.account>>, other: typeof owner, member: typeof owner;
let source: string, root: string, sourceHash: string, skill: any;
const uid = randomUUID();
const binding = { shopName: 'DEMOB', market: 'US', productId: '9100000000000001001' };
const second = { shopName: 'DEMA', market: 'US', productId: '9100000000000003001' };
let catalog: any;
const sync = async () => { await writeFile(source, JSON.stringify(catalog)); const r = await app.inject({ method: 'POST', url: '/api/product-catalog/sync', headers: owner.headers, payload: {} }); expect(r.json().stale).toBe(false); sourceHash = r.json().sourceHash; };
const choose = (patch = {}, account = owner) => app.inject({ method: 'POST', url: '/api/product-catalog/selections', headers: account.headers, payload: { productUid: uid, sourceHash, binding, assetIds: ['main', 'detail'], ...patch } });
const group = (set: any) => ({ source: 'catalog', catalogSelectionId: set.id, styleNumber: '伪造款号', name: '伪造名称', mediaIds: set.media.map((m: any) => m.id), catalog: { ...set.catalog, binding: { ...set.catalog.binding, productId: second.productId } } });
const input = (set: any) => ({ name: '商品身份', platform: 'tiktok', market: 'US', category: '服装', targetDuration: 15, model: 'seedance-2.5', generatePerson: false, generateScene: false, selections: [{ id: skill.id, versionId: skill.versionId, duration: 15 }], media: set.media, productGroups: [group(set)] });
const count = async (table: string) => Number((await h.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

beforeAll(async () => {
  h = await harness('catalog_select', 'http://127.0.0.1:4178', true);
  owner = await h.account('admin'); other = await h.account('admin'); member = await h.account();
  root = path.join(h.context.dataRoot, 'source-images'); source = path.join(h.context.dataRoot, 'catalog.json'); await mkdir(root, { recursive: true });
  for (const file of ['main.png', 'detail.png']) await writeFile(path.join(root, file), await sharp({ create: { width: 8, height: 8, channels: 3, background: '#777' } }).png().toBuffer());
  catalog = { generatedAt: '2026-11-04', products: [{ id: 'men:6121', productUid: uid, category: 'men', sku: '6121', name: '牛仔裤', title: '', sizes: [], note: '', coverId: 'main', folders: [{ id: 'folder', label: '资料', path: root }], assets: [{ id: 'main', kind: 'main', label: '主图', path: path.join(root, 'main.png') }, { id: 'detail', kind: 'detail', label: '详情', path: path.join(root, 'detail.png') }], shopBindings: [binding, second].map(b => ({ ...b, productUrl: null, matchStatus: 'image_matched' })) }] };
  app = await buildApp({ ...h.context, catalog: { sourcePath: source, allowedRoots: [root] } }); await sync();
  skill = (await app.inject({ method: 'POST', url: '/api/skills', headers: owner.headers, payload: { name: '展示', kind: 'full', duration: 15, text: '# 裤装展示\n展示所选商品' } })).json();
});
afterAll(async () => { await app?.close(); await h?.close(); });

describe('产品表选款的可信来源与冻结身份', () => {
  it('仅使用时导入用户图片，保存完整ID，并发相同选择幂等且不覆盖原图或手动图套', async () => {
    const original = await readFile(source), image = await readFile(path.join(root, 'main.png'));
    const results = await Promise.all([choose(), choose()]);
    results.forEach(r => expect(r.statusCode, r.body).toBe(200));
    const saved = results[0].json(); expect(results[1].json().id).toBe(saved.id);
    expect(saved.catalog.binding.productId).toBe(binding.productId); expect(saved.media).toHaveLength(2);
    expect(await count('product_catalog_selections')).toBe(1); expect(await count('media')).toBe(2); expect(await count('product_sets')).toBe(0);
    expect(await readFile(source)).toEqual(original); expect(await readFile(path.join(root, 'main.png'))).toEqual(image);
    for (const table of ['jobs', 'tasks', 'canvas_imports']) expect(await count(table)).toBe(0);
  });
  it('同款两个店铺分别记录，跨用户不可读取或用其素材', async () => {
    const a = (await choose()).json(), b = (await choose({ binding: second })).json();
    expect(a.id).not.toBe(b.id); expect(b.catalog.binding.productId).toBe(second.productId);
    expect((await app.inject({ url: `/api/product-catalog/selections/${a.id}`, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers: other.headers, payload: { name: '越权', input: input(a) } })).statusCode).toBe(404);
  });
  it('单连接池并发重试复用已保存记录，不等待事务之外的第二条连接', async () => {
    const saved = (await choose()).json();
    const limited = createDatabase(h.db.options.connectionString!); limited.options.max = 1;
    const single = await buildApp({ ...h.context, db: limited, catalog: { sourcePath: source, allowedRoots: [root] } });
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => single.inject({ method: 'POST', url: '/api/product-catalog/selections', headers: owner.headers, payload: { productUid: uid, sourceHash, binding, assetIds: ['main', 'detail'] } })));
      expect(results.every(r => r.statusCode === 200 && r.json().id === saved.id)).toBe(true);
    } finally { await single.close(); await limited.end(); }
  });
  it('数据库保存失败回滚全部新媒体和文件，不影响已有选用', async () => {
    const before = await count('media'), records = await count('product_catalog_selections');
    await h.db.query("CREATE FUNCTION reject_catalog_selection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$");
    await h.db.query('CREATE TRIGGER reject_catalog_selection BEFORE INSERT ON product_catalog_selections FOR EACH ROW EXECUTE FUNCTION reject_catalog_selection()');
    try {
      expect((await choose({ assetIds: ['main'] }, other)).statusCode).toBe(500);
      expect(await count('media')).toBe(before); expect(await count('product_catalog_selections')).toBe(records);
      expect((await readdir(path.join(h.context.dataRoot, 'media'))).length).toBe(before);
    } finally { await h.db.query('DROP TRIGGER reject_catalog_selection ON product_catalog_selections'); await h.db.query('DROP FUNCTION reject_catalog_selection()'); }
  });
  it('草稿和任务覆盖客户端伪造身份，冻结ID，不创建生成作业', async () => {
    const saved = (await choose()).json();
    const draft = await app.inject({ method: 'POST', url: '/api/drafts', headers: owner.headers, payload: { name: '草稿', input: input(saved) } }); expect(draft.statusCode, draft.body).toBe(200);
    const drafts = (await app.inject({ url: '/api/drafts', headers: owner.headers })).json();
    expect(drafts.find((d: any) => d.id === draft.json().id).input.productGroups[0]).toMatchObject({ styleNumber: '6121', catalog: { binding } });
    const task = await app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: input(saved) }); expect(task.statusCode, task.body).toBe(200);
    const detail = (await app.inject({ url: `/api/tasks/${task.json().id}`, headers: owner.headers })).json();
    expect(detail.snapshot.input.productGroups[0].catalog.binding.productId).toBe(binding.productId);
    expect(detail.snapshot.input.productSetId).toBeUndefined(); expect(await count('jobs')).toBe(0);
  });
  it('拒绝不匹配图片/来源/市场及重复绑定组，不接受主图被移除', async () => {
    const saved = (await choose()).json(), another = (await choose({ binding: second })).json();
    for (const payload of [
      { ...input(saved), market: 'VN' },
      { ...input(saved), media: another.media },
      { ...input(saved), productGroups: [{ ...group(saved), mediaIds: [saved.media[1].id] }] },
      { ...input(saved), productUse: 'colors', productGroups: [group(saved), group(saved)] },
    ]) expect((await app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload })).statusCode).toBe(400);
    expect((await choose({ binding: { ...binding, productId: '9999999999999999999' } })).statusCode).toBe(409);
    expect((await choose({ sourceHash: 'a'.repeat(64) })).statusCode).toBe(409);
    expect((await choose({ assetIds: ['main', '../secret'] })).statusCode).toBe(400);
  });
  it('不完整草稿保留冻结绑定：未选脚本、移除全部图片仍可保存，不能伪造手动来源', async () => {
    const saved = (await choose()).json();
    const partial = { market: 'US', media: [], productGroups: [{ ...group(saved), catalog: undefined, mediaIds: [] }] };
    const result = await app.inject({ method: 'POST', url: '/api/drafts', headers: owner.headers, payload: { name: '未完成选图', input: partial } });
    expect(result.statusCode, result.body).toBe(200);
    const stored = (await app.inject({ url: '/api/drafts', headers: owner.headers })).json().find((draft: any) => draft.id === result.json().id);
    expect(stored.input.productGroups[0]).toMatchObject({ mediaIds: [], catalog: { binding } });
    const forged = { ...input(saved), productGroups: [{ ...group(saved), source: 'manual', productSetId: randomUUID() }] };
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers: owner.headers, payload: { name: '不允许混合来源', input: forged } })).statusCode).toBe(400);
  });
  it('选用入口拒绝数字ID、重复图片、超过12张和省略店铺绑定', async () => {
    for (const patch of [{ binding: { ...binding, productId: 9100000000000001001 } }, { assetIds: ['main', 'main'] }, { assetIds: Array.from({ length: 13 }, (_, i) => String(i)) }, { binding: undefined }]) {
      expect((await choose(patch)).statusCode).toBe(400);
    }
  });
  it('缺图/损坏图全量拒绝，不留下部分媒体或选用记录', async () => {
    const bytes = await readFile(path.join(root, 'detail.png')); const before = await count('media'), records = await count('product_catalog_selections');
    await writeFile(path.join(root, 'detail.png'), 'broken');
    expect((await choose()).statusCode).toBe(409);
    expect(await count('media')).toBe(before); expect(await count('product_catalog_selections')).toBe(records);
    expect((await readdir(path.join(h.context.dataRoot, 'media'))).length).toBe(before);
    await writeFile(path.join(root, 'detail.png'), bytes);
  });
  it('新来源修订产生新记录，旧选用/任务不跟随当前商品ID变动', async () => {
    const old = (await choose()).json(); catalog.products[0].shopBindings[0].productId = '9100000000000001088'; await sync();
    const newer = await choose({ binding: { ...binding, productId: '9100000000000001088' } }); expect(newer.statusCode, newer.body).toBe(200);
    expect(newer.json().id).not.toBe(old.id);
    const frozen = await app.inject({ url: `/api/product-catalog/selections/${old.id}`, headers: owner.headers }); expect(frozen.json().catalog.binding.productId).toBe(binding.productId);
    const task = await app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: input(old) }); expect(task.statusCode, task.body).toBe(200);
    catalog.products[0].shopBindings[0].productId = binding.productId; await sync();
  });
  it('源同步失败/移除/待复核不允许新的选择', async () => {
    const product = structuredClone(catalog.products[0]);
    catalog.products[0].shopBindings[0].matchStatus = 'pending'; await sync(); expect((await choose()).statusCode).toBe(409);
    catalog.products = []; await sync(); expect((await choose()).statusCode).toBe(409);
    catalog.products = [product]; await sync();
    await writeFile(source, '{broken'); await app.inject({ method: 'POST', url: '/api/product-catalog/sync', headers: owner.headers, payload: {} }); expect((await choose()).statusCode).toBe(409); await sync();
  });
  it('选用读写端点继承本机管理员和CSRF限制', async () => {
    expect((await choose({}, member)).statusCode).toBe(403);
    const selection = (await choose()).json();
    for (const method of ['POST', 'GET'] as const) {
      const url = method === 'POST' ? '/api/product-catalog/selections' : `/api/product-catalog/selections/${selection.id}`;
      expect((await app.inject({ method, url, headers: owner.headers, remoteAddress: '192.168.1.5' })).statusCode).toBe(403);
      expect((await app.inject({ method, url, headers: { origin: h.context.origin } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/product-catalog/selections', headers: { ...owner.headers, 'x-csrf-token': '' }, payload: {} })).statusCode).toBe(403);
  });
});
