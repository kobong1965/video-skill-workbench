import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { creationSchema, type ProductImageSet } from '../../packages/contracts';

let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let other: typeof owner;
let groups: ProductImageSet[];
let foreignSet: ProductImageSet;
let selection: { id: string; versionId: string; duration: number };
let manualImage: string;
const postTask = (payload: unknown) => h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: payload as object });
const inputFor = (sets = groups.slice(0, 3)) => ({
  name: '多款号测试', platform: 'tiktok', market: 'US', category: '服装', targetDuration: 15, model: 'seedance-2.5',
  generatePerson: false, generateScene: false, voice: 'none', selections: [selection], productUse: 'colors',
  media: sets.flatMap(set => set.media.map(({ id, role }) => ({ id, role }))),
  productGroups: sets.map(set => ({ productSetId: set.id, styleNumber: '不可信客户端款号', name: '不可信客户端名称', mediaIds: set.media.map(item => item.id) })),
});
const taskDetail = async (id: string) => (await h.app.inject({ url: `/api/tasks/${id}`, headers: owner.headers })).json();
async function setWithImages(styleNumber: string, count: number, account = owner): Promise<ProductImageSet> {
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#777' } }).png().toBuffer();
  const media = [];
  for (let index = 0; index < count; index++) media.push({ id: (await saveMedia(h.context, account.id, `${styleNumber}-${index}.png`, bytes)).id, role: index === 0 ? 'product' : 'detail' });
  const response = await h.app.inject({ method: 'POST', url: '/api/product-sets', headers: account.headers, payload: { styleNumber, name: `${styleNumber}裤装`, media } });
  expect(response.statusCode).toBe(200);
  return response.json();
}

beforeAll(async () => {
  h = await harness('multi_product_sets'); owner = await h.account('admin'); other = await h.account();
  groups = [];
  for (const style of ['6258黑色', '6258深蓝', '6258浅蓝', '搭配上衣', '帽子', '鞋']) groups.push(await setWithImages(style, 6));
  foreignSet = await setWithImages('他人的裤子', 2, other);
  manualImage = (await saveMedia(h.context, owner.id, '额外细节.png', await sharp({ create: { width: 10, height: 10, channels: 3, background: '#222' } }).png().toBuffer())).id;
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: owner.headers, payload: { name: '多色换装', kind: 'full', duration: 15, text: '# 多色换装\n按照所选商品逐个换装展示' } })).json();
  selection = { id: skill.id, versionId: skill.versionId, duration: 15 };
});
afterAll(async () => h.close());

describe('多款号任务契约与规范化', () => {
  it('十八张图和三组按选择顺序完整冻结，并用服务端款号名称替换客户端值', async () => {
    const input = inputFor([groups[2], groups[0], groups[1]]);
    const response = await postTask({ ...input, productSetId: groups[0].id, styleNumber: '旧单款号' });
    expect(response.statusCode).toBe(200);
    const task = await taskDetail(response.json().id);
    expect(task.snapshot.media).toHaveLength(18);
    expect(task.snapshot.input.media).toEqual(input.media);
    expect(task.snapshot.input.productGroups).toEqual([groups[2], groups[0], groups[1]].map(set => ({ productSetId: set.id, styleNumber: set.styleNumber, name: set.name, mediaIds: set.media.map(item => item.id) })));
    expect(task.snapshot.input).not.toHaveProperty('productSetId');
    expect(task.snapshot.input).not.toHaveProperty('styleNumber');
    expect(task.jobs).toEqual([]);
  });

  it('允许六组共三十六张；三十七张在任务建立前明确拒绝', async () => {
    const allowed = await postTask(inputFor(groups));
    expect(allowed.statusCode).toBe(200);
    expect((await taskDetail(allowed.json().id)).snapshot.media).toHaveLength(36);
    const oversized = inputFor(groups); oversized.media.push({ id: manualImage, role: 'detail' });
    const rejected = await postTask(oversized);
    expect(rejected.statusCode).toBe(400);
  });

  it('六组上限、每组十二张上限、重复组和重复组内ID都由契约拒绝', () => {
    const input = inputFor();
    expect(creationSchema.safeParse(input).success).toBe(true);
    expect(creationSchema.safeParse({ ...input, productGroups: [...input.productGroups, input.productGroups[0]] }).success).toBe(false);
    expect(creationSchema.safeParse({ ...input, productGroups: Array.from({ length: 7 }, () => ({ ...input.productGroups[0], productSetId: randomUUID() })) }).success).toBe(false);
    expect(creationSchema.safeParse({ ...input, productGroups: [{ ...input.productGroups[0], mediaIds: Array.from({ length: 13 }, () => randomUUID()) }] }).success).toBe(false);
    expect(creationSchema.safeParse({ ...input, productGroups: [{ ...input.productGroups[0], mediaIds: [groups[0].media[0].id, groups[0].media[0].id] }] }).success).toBe(false);
  });

  it('多组必须明确换色、搭配或对比用途；单组不用新增用途也可用', async () => {
    const input = inputFor();
    const { productUse: _use, ...missingUse } = input;
    expect((await postTask(missingUse)).statusCode).toBe(400);
    expect((await postTask({ ...input, productUse: 'guess' })).statusCode).toBe(400);
    const single = inputFor(groups.slice(0, 1));
    const { productUse: _singleUse, ...withoutUse } = single;
    const response = await postTask(withoutUse);
    expect(response.statusCode).toBe(200);
    expect((await taskDetail(response.json().id)).snapshot.input).toMatchObject({ productSetId: groups[0].id, styleNumber: groups[0].styleNumber });
  });

  it('跨用户或不存在的图套拒绝，不生成任务或Job', async () => {
    const before = Number((await h.db.query('SELECT count(*) FROM tasks WHERE owner_id=$1', [owner.id])).rows[0].count);
    for (const setId of [foreignSet.id, randomUUID()]) {
      const input = inputFor(); input.productGroups[0].productSetId = setId;
      expect((await postTask(input)).statusCode).toBe(404);
    }
    expect(Number((await h.db.query('SELECT count(*) FROM tasks WHERE owner_id=$1', [owner.id])).rows[0].count)).toBe(before);
    expect(Number((await h.db.query('SELECT count(*) FROM jobs')).rows[0].count)).toBe(0);
  });

  it('不能把其他组或手动图片伪装成某一图套的图片', async () => {
    for (const id of [groups[1].media[0].id, manualImage]) {
      const input = inputFor(); input.productGroups[0].mediaIds = [id];
      if (id === manualImage) input.media.push({ id, role: 'detail' });
      const response = await postTask(input);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('图套');
    }
  });

  it('分组图片必须出现在本任务选图，删除了主图或清空组都不能提交', async () => {
    const withoutTaskImage = inputFor(); withoutTaskImage.media = withoutTaskImage.media.filter(item => item.id !== groups[0].media[1].id);
    expect((await postTask(withoutTaskImage)).statusCode).toBe(400);
    const withoutMain = inputFor(); withoutMain.productGroups[0].mediaIds.shift(); withoutMain.media.shift();
    expect((await postTask(withoutMain)).statusCode).toBe(400);
    const empty = inputFor(); empty.productGroups[0].mediaIds = [];
    expect((await postTask(empty)).statusCode).toBe(400);
  });

  it('换色和搭配每组都须保留至少一张非对比主商品图', async () => {
    for (const productUse of ['colors', 'outfit']) {
      const input = inputFor();
      input.media = input.media.map(item => groups[1].media.some(image => image.id === item.id) ? { ...item, role: 'comparison' } : item);
      const response = await postTask({ ...input, productUse });
      expect(response.statusCode).toBe(400);
    }
  });

  it('对比用途以首组为主商品，其余组统一降为对比图，不能混入主商品特征', async () => {
    const input = inputFor();
    const response = await postTask({ ...input, productUse: 'comparison' });
    expect(response.statusCode).toBe(200);
    const task = await taskDetail(response.json().id);
    const expected = input.media.map(item => groups[0].media.some(image => image.id === item.id) ? item : { ...item, role: 'comparison' });
    expect(task.snapshot.input.media).toEqual(expected);
    expect(task.snapshot.media.map(({ id, role }: { id: string; role: string }) => ({ id, role }))).toEqual(expected);
  });

  it('对比首组不能仅有对比图；主商品和对比组共享ID时明确拒绝', async () => {
    const noMain = inputFor(); noMain.media = noMain.media.map(item => groups[0].media.some(image => image.id === item.id) ? { ...item, role: 'comparison' } : item);
    expect((await postTask({ ...noMain, productUse: 'comparison' })).statusCode).toBe(400);
    const sharedSet = (await h.app.inject({ method: 'POST', url: '/api/product-sets', headers: owner.headers, payload: { styleNumber: '共享主图款', media: [{ id: groups[0].media[0].id, role: 'product' }] } })).json() as ProductImageSet;
    const shared = inputFor([groups[0], sharedSet]);
    shared.media = shared.media.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    const response = await postTask({ ...shared, productUse: 'comparison' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/共享|冲突/);
  });

  it('允许额外手动细节图和普通模式跨组共享参考图，完整保留关系', async () => {
    const sharedSet = (await h.app.inject({ method: 'POST', url: '/api/product-sets', headers: owner.headers, payload: { styleNumber: '共享搭配图', media: [{ id: groups[0].media[0].id, role: 'product' }] } })).json() as ProductImageSet;
    const input = inputFor([groups[0], sharedSet]);
    input.media = input.media.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    input.media.push({ id: manualImage, role: 'detail' });
    const response = await postTask({ ...input, productUse: 'outfit' });
    expect(response.statusCode).toBe(200);
    const task = await taskDetail(response.json().id);
    expect(task.snapshot.input.productGroups.map((group: { mediaIds: string[] }) => group.mediaIds)).toEqual(input.productGroups.map(group => group.mediaIds));
    expect(task.snapshot.media).toHaveLength(7);
  });

  it('共享图片在不同图套的原始用途不一致时明确拒绝，不能以扁平用途覆盖组内用途', async () => {
    const before = Number((await h.db.query('SELECT count(*) FROM tasks WHERE owner_id=$1', [owner.id])).rows[0].count);
    for (const role of ['detail', 'comparison'] as const) {
      const response = await h.app.inject({ method: 'POST', url: '/api/product-sets', headers: owner.headers, payload: {
        styleNumber: `共享用途冲突-${role}`, media: [{ id: groups[1].media[0].id, role: 'product' }, { id: groups[0].media[0].id, role }],
      } });
      expect(response.statusCode).toBe(200);
      const input = inputFor([groups[0], response.json() as ProductImageSet]);
      input.media = input.media.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
      for (const productUse of ['colors', 'outfit']) {
        const task = await postTask({ ...input, productUse });
        expect(task.statusCode).toBe(400);
        expect(task.json().error).toBe('同一图片在不同图套的用途不一致，请调整图套或移除重复图片');
      }
    }
    expect(Number((await h.db.query('SELECT count(*) FROM tasks WHERE owner_id=$1', [owner.id])).rows[0].count)).toBe(before);
    expect(Number((await h.db.query('SELECT count(*) FROM jobs')).rows[0].count)).toBe(0);
  });

  it('图套后续编辑不改变已存任务分组、图片角色和图片顺序', async () => {
    const set = await setWithImages('冻结前', 2);
    const response = await postTask(inputFor([set, groups[0]]));
    expect(response.statusCode).toBe(200);
    const before = (await taskDetail(response.json().id)).snapshot;
    await h.app.inject({ method: 'PUT', url: `/api/product-sets/${set.id}`, headers: owner.headers, payload: { styleNumber: '冻结后', name: '更新名称', media: [{ id: manualImage, role: 'product' }] } });
    expect((await taskDetail(response.json().id)).snapshot).toEqual(before);
  });

  it('旧单图套、纯手动任务和旧草稿继续可用', async () => {
    const { productGroups: _groups, productUse: _use, ...legacy } = inputFor(groups.slice(0, 1));
    const response = await postTask({ ...legacy, productSetId: groups[0].id, styleNumber: '客户端旧名' });
    expect(response.statusCode).toBe(200);
    expect((await taskDetail(response.json().id)).snapshot.input.styleNumber).toBe(groups[0].styleNumber);
    expect((await postTask(legacy)).statusCode).toBe(200);
    const draft = await h.app.inject({ method: 'POST', url: '/api/drafts', headers: owner.headers, payload: { name: '十八图草稿', input: inputFor() } });
    expect(draft.statusCode).toBe(200);
    const drafts = (await h.app.inject({ url: '/api/drafts', headers: owner.headers })).json();
    expect(drafts.find((row: { id: string }) => row.id === draft.json().id).input.media).toHaveLength(18);
  });

  it('保存提示词修订必须实际引用全部所选组；完整三十六图引用不受旧二十张边界限制', async () => {
    const response = await postTask(inputFor(groups));
    expect(response.statusCode).toBe(200);
    const taskId = response.json().id;
    const output = {
      productFacts: [], unknowns: [], conflicts: [], globalPrompt: '真实光线拍摄，分别保留每组商品的结构与颜色。', assetPlan: [],
      shots: [{ skillVersionId: selection.versionId, duration: 15, title: '逐款展示', prompt: '保持每款商品独立，按所选顺序展示。', dialogue: '', translation: '', storyAudio: '低音量器乐音乐', startState: '正面站立', endState: '自然站定', references: groups[0].media.map(item => item.id) }],
    };
    const save = (output: unknown) => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: owner.headers, payload: { output } });
    const missing = await save(output);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toContain(groups[1].styleNumber);
    expect((await taskDetail(taskId)).results).toEqual([]);
    output.shots[0].references = groups.flatMap(set => set.media.map(item => item.id));
    const saved = await save(output);
    expect(saved.statusCode).toBe(200);
    expect((await taskDetail(taskId)).results[0].output.shots[0].references).toHaveLength(36);
  });
});
