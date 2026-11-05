import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { buildApp } from '../../apps/api/app';

let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let other: typeof owner;
let images: string[];
let foreignImage: string;
let document: string;
let selection: { id: string; versionId: string; duration: number };
const requestBody = (styleNumber: string, media = [{ id: images[0], role: 'product' }]) => ({ styleNumber, name: '测试裤装', media });
const createSet = (payload: unknown, headers: Record<string, string> = owner.headers) => h.app.inject({ method: 'POST', url: '/api/product-sets', headers, payload: payload as object });
const updateSet = (id: string, payload: unknown, headers: Record<string, string> = owner.headers) => h.app.inject({ method: 'PUT', url: `/api/product-sets/${id}`, headers, payload: payload as object });
async function saved(styleNumber: string) {
  const response = await createSet(requestBody(styleNumber));
  expect(response.statusCode).toBe(200);
  return response.json() as { id: string; styleNumber: string; name: string; media: { id: string; role: string; name: string }[]; createdAt: string; updatedAt: string };
}

beforeAll(async () => {
  h = await harness('product_sets'); owner = await h.account('admin'); other = await h.account();
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#777' } }).png().toBuffer();
  images = [];
  for (const name of ['正面.png', '侧面.png', '细节.png']) images.push((await saveMedia(h.context, owner.id, name, png)).id);
  foreignImage = (await saveMedia(h.context, other.id, '他人款式.png', png)).id;
  document = (await saveMedia(h.context, owner.id, '非图片.md', Buffer.from('# 这不是图片'))).id;
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: owner.headers, payload: { name: '图套开头', kind: 'opening', duration: 3, text: '# 图套开头\n三秒产品近景' } })).json();
  selection = { id: skill.id, versionId: skill.versionId, duration: 3 };
});
afterAll(async () => h.close());

describe('款号图套持久存储与复用', () => {
  it('保存规范款号、图片顺序与角色，并在新服务实例中读回', async () => {
    const response = await createSet({ styleNumber: '  SKU-9001  ', name: '  灰色长裤  ', media: [{ id: images[0], role: 'product' }, { id: images[1], role: 'detail' }, { id: images[2], role: 'comparison' }] });
    expect(response.statusCode).toBe(200);
    const set = response.json();
    expect(set).toMatchObject({ styleNumber: 'SKU-9001', name: '灰色长裤', media: [{ id: images[0], role: 'product', name: '正面.png' }, { id: images[1], role: 'detail', name: '侧面.png' }, { id: images[2], role: 'comparison', name: '细节.png' }] });
    expect(set.id).toMatch(/^[a-f0-9-]{36}$/); expect(Date.parse(set.createdAt)).not.toBeNaN(); expect(Date.parse(set.updatedAt)).not.toBeNaN();
    const restarted = await buildApp(h.context);
    try {
      const result = await restarted.inject({ url: `/api/product-sets/${set.id}`, headers: owner.headers });
      expect(result.statusCode).toBe(200); expect(result.json()).toEqual(set);
      expect((await restarted.inject({ url: '/api/product-sets', headers: owner.headers })).json()).toContainEqual(set);
    } finally { await restarted.close(); }
  });

  it('同一账号款号忽略大小写唯一；其他账号可以保存同款号', async () => {
    await saved('Unique-A');
    expect((await createSet(requestBody(' unique-a '))).statusCode).toBe(409);
    const response = await createSet(requestBody('UNIQUE-A', [{ id: foreignImage, role: 'product' }]), other.headers);
    expect(response.statusCode).toBe(200);
  });

  it('并发创建相同款号只保存一套', async () => {
    const results = await Promise.all([createSet(requestBody('Race-A')), createSet(requestBody('race-a'))]);
    expect(results.map(x => x.statusCode).sort()).toEqual([200, 409]);
    const list = (await h.app.inject({ url: '/api/product-sets', headers: owner.headers })).json() as { styleNumber: string }[];
    expect(list.filter(x => x.styleNumber.toLowerCase() === 'race-a')).toHaveLength(1);
  });

  it('拒绝空款号、过长名称、非图片、无主图、重复图片及超过十二张', async () => {
    const invalid = [requestBody('   '), requestBody('A'.repeat(81)), { ...requestBody('Bad-name'), name: '名'.repeat(101) }, requestBody('Bad-doc', [{ id: document, role: 'product' }]), requestBody('Bad-role', [{ id: images[0], role: 'detail' }]), requestBody('Bad-duplicate', [{ id: images[0], role: 'product' }, { id: images[0], role: 'detail' }]), requestBody('Bad-limit', Array.from({ length: 13 }, () => ({ id: randomUUID(), role: 'product' }))), requestBody('Bad-empty', [])];
    for (const payload of invalid) expect((await createSet(payload)).statusCode).toBe(400);
    const list = (await h.app.inject({ url: '/api/product-sets', headers: owner.headers })).json() as { styleNumber: string }[];
    expect(list.some(x => x.styleNumber.startsWith('Bad-'))).toBe(false);
  });

  it('未登录、跨账号读写和跨账号媒体都被拒绝，列表不泄露他人款式', async () => {
    const set = await saved('Private-A');
    expect((await h.app.inject({ url: '/api/product-sets' })).statusCode).toBe(401);
    expect((await h.app.inject({ url: `/api/product-sets/${set.id}`, headers: other.headers })).statusCode).toBe(404);
    expect((await updateSet(set.id, requestBody('Stolen', [{ id: foreignImage, role: 'product' }]), other.headers)).statusCode).toBe(404);
    expect((await createSet(requestBody('Foreign-media', [{ id: foreignImage, role: 'product' }]))).statusCode).toBe(404);
    expect((await createSet(requestBody('Missing-media', [{ id: randomUUID(), role: 'product' }]))).statusCode).toBe(404);
    const list = (await h.app.inject({ url: '/api/product-sets', headers: other.headers })).json() as { id: string }[];
    expect(list.some(x => x.id === set.id)).toBe(false);
    const withoutCsrf = { ...owner.headers, 'x-csrf-token': '' };
    expect((await createSet(requestBody('No-CSRF'), withoutCsrf)).statusCode).toBe(403);
  });

  it('整组更新保持图套标识，替换顺序角色且不删除原媒体', async () => {
    const set = await saved('Update-A');
    const response = await updateSet(set.id, { styleNumber: 'Update-B', media: [{ id: images[2], role: 'product' }, { id: images[1], role: 'detail' }] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: set.id, styleNumber: 'Update-B', name: '', createdAt: set.createdAt, media: [{ id: images[2], role: 'product' }, { id: images[1], role: 'detail' }] });
    expect((await h.app.inject({ url: `/api/media/${images[0]}`, headers: owner.headers })).statusCode).toBe(200);
  });

  it('无效更新或重复款号不改变已有图套或图片绑定', async () => {
    const set = await saved('Atomic-A'); await saved('Atomic-B');
    expect((await updateSet(set.id, requestBody('Atomic-changed', [{ id: images[1], role: 'product' }, { id: foreignImage, role: 'detail' }]))).statusCode).toBe(404);
    expect((await updateSet(set.id, requestBody('atomic-b', [{ id: images[1], role: 'product' }]))).statusCode).toBe(409);
    expect((await h.app.inject({ url: `/api/product-sets/${set.id}`, headers: owner.headers })).json()).toEqual(set);
  });

  it('创建任务冻结当前选图和规范款号，后续更新图套不会改动旧任务', async () => {
    const set = await saved('Frozen-A');
    const input = { name: '图套复用任务', productSetId: set.id, styleNumber: '伪造款号', media: [{ id: images[0], role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 15, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none', selections: [selection] };
    const response = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: input });
    expect(response.statusCode).toBe(200);
    const taskId = response.json().id;
    await updateSet(set.id, requestBody('Frozen-B', [{ id: images[1], role: 'product' }]));
    const detail = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: owner.headers })).json();
    expect(detail.snapshot.input).toMatchObject({ productSetId: set.id, styleNumber: 'Frozen-A', media: input.media });
    expect(detail.snapshot.media).toEqual([{ id: images[0], role: 'product', name: '正面.png', mime: 'image/png' }]);
    const foreignSet = (await createSet(requestBody('Other-A', [{ id: foreignImage, role: 'product' }]), other.headers)).json();
    expect((await h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: { ...input, productSetId: foreignSet.id } })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: { ...input, productSetId: randomUUID() } })).statusCode).toBe(404);
    const { productSetId: _set, styleNumber: _style, ...legacy } = input;
    expect((await h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: legacy })).statusCode).toBe(200);
  });

  it('图套和人物场景库独立，已保存草稿仍可存储旧格式', async () => {
    expect((await h.app.inject({ url: '/api/assets', headers: owner.headers })).json()).toEqual([]);
    const legacy = await h.app.inject({ method: 'POST', url: '/api/drafts', headers: owner.headers, payload: { name: '旧版草稿', input: { media: [{ id: images[0], role: 'product' }] } } });
    expect(legacy.statusCode).toBe(200);
    expect((await h.app.inject({ url: '/api/drafts', headers: owner.headers })).json()).toContainEqual(expect.objectContaining({ id: legacy.json().id, input: { media: [{ id: images[0], role: 'product' }] } }));
  });

  it('列表不会在两百套时静默截断', async () => {
    // Populate lightweight metadata directly to exercise a realistically larger private library.
    for (let index = 0; index < 201; index++) {
      const id = randomUUID();
      await h.db.query('INSERT INTO product_sets(id,owner_id,style_number,name) VALUES($1,$2,$3,$4)', [id, owner.id, `Bulk-${index}`, '批量款号']);
      await h.db.query('INSERT INTO product_set_media(product_set_id,media_id,role,position) VALUES($1,$2,$3,0)', [id, images[0], 'product']);
    }
    const response = await h.app.inject({ url: '/api/product-sets', headers: owner.headers });
    expect(response.statusCode).toBe(200);
    const sets = response.json() as { styleNumber: string; media: { id: string }[] }[];
    expect(sets.filter(x => x.styleNumber.startsWith('Bulk-'))).toHaveLength(201);
    expect(sets.find(x => x.styleNumber === 'Bulk-0')?.media[0].id).toBe(images[0]);
  });
});
