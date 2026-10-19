import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import type { SkillInfo } from '../../packages/contracts';

let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let author: typeof owner;
let stranger: typeof owner;
let productId: string;
beforeAll(async () => {
  h = await harness('task_skill_previews', undefined, true);
  owner = await h.account(); author = await h.account('admin'); stranger = await h.account();
  productId = (await image(owner, 'product.png')).id;
});
afterAll(async () => h.close());
async function image(user: typeof owner, name: string) {
  return saveMedia(h.context, user.id, name, await sharp({ create: { width: 12, height: 12, channels: 3, background: '#abc' } }).png().toBuffer());
}
async function skill(name: string, user = owner, visibility = 'private'): Promise<SkillInfo> {
  const response = await h.app.inject({ method: 'POST', url: '/api/skills', headers: user.headers, payload: {
    name, text: '# 正文只保存到任务，不进入概况', kind: 'opening', duration: 3, visibility, sharingConfirmed: visibility === 'public',
  } });
  expect(response.statusCode).toBe(200); return response.json();
}
async function attach(versionId: string, mediaId: string, path: string, mime = 'image/png') {
  await h.db.query('INSERT INTO skill_files(version_id,path,mime,media_id) VALUES($1,$2,$3,$4)', [versionId, path, mime, mediaId]);
}
async function task(skills: SkillInfo[], extra: Record<string, unknown> = {}) {
  const response = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: {
    name: '款号6258', media: [{ id: productId, role: 'product' }], platform: 'tiktok', market: 'US', category: '服装',
    targetDuration: 30, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none',
    selections: skills.map(item => ({ id: item.id, versionId: item.versionId, duration: 3 })), ...extra,
  } });
  expect(response.statusCode).toBe(200); return response.json().id as string;
}
async function summary(id: string, endpoint = '/api/task-board') {
  const response = await h.app.inject({ url: endpoint, headers: owner.headers });
  expect(response.statusCode).toBe(200);
  return response.json().find((item: { id: string }) => item.id === id);
}
async function makeLegacy(id: string) {
  await h.db.query(`UPDATE tasks SET snapshot=jsonb_set(snapshot,'{skills}',
    (SELECT jsonb_agg(item-'preview') FROM jsonb_array_elements(snapshot->'skills') item)) WHERE id=$1`, [id]);
}

describe('任务脚本封面轻量概况', () => {
  it('单脚本返回商品与脚本封面，两种概况接口一致且不触发生成', async () => {
    const selected = await skill('单脚本封面');
    const cover = await image(owner, 'cover.png');
    const video = await saveMedia(h.context, owner.id, 'effect.mp4', Buffer.from('0000ftypfixture'));
    await attach(selected.versionId, cover.id, 'previews/poster.png');
    await attach(selected.versionId, video.id, 'previews/effect.mp4', 'video/mp4');
    const id = await task([selected]);
    const expected = [{ id: selected.id, versionId: selected.versionId, name: selected.name, imageMediaId: cover.id, videoMediaId: video.id }];
    expect((await summary(id)).skillPreviews).toEqual(expected);
    expect((await summary(id, '/api/tasks')).skillPreviews).toEqual(expected);
    expect((await summary(id)).thumbnailMediaId).toBe(productId);
    expect((await h.db.query('SELECT count(*) FROM jobs')).rows[0].count).toBe('0');
  });

  it('组合脚本保持选择顺序和任务时名称，不受脚本重命名影响', async () => {
    const first = await skill('开头'); const second = await skill('展示');
    const cover = await image(owner, 'second.png'); await attach(second.versionId, cover.id, 'previews/second.png');
    const id = await task([second, first]);
    await h.db.query('UPDATE skills SET name=$1 WHERE id=$2', ['已改名', second.id]);
    expect((await summary(id)).skillPreviews).toEqual([
      { id: second.id, versionId: second.versionId, name: '展示', imageMediaId: cover.id, videoMediaId: null },
      { id: first.id, versionId: first.versionId, name: '开头', imageMediaId: null, videoMediaId: null },
    ]);
  });

  it('历史任务只读选中版本，不随新版脚本替换封面', async () => {
    const selected = await skill('历史版本'); const oldCover = await image(owner, 'old.png');
    await attach(selected.versionId, oldCover.id, 'previews/old.png');
    const id = await task([selected]); await makeLegacy(id);
    const version = await h.app.inject({ method: 'POST', url: `/api/skills/${selected.id}/versions`, headers: owner.headers, payload: { kind: 'opening', duration: 3, text: '# 新版' } });
    expect(version.statusCode).toBe(200);
    const newCover = await image(owner, 'new.png');
    await h.db.query("DELETE FROM skill_files WHERE version_id=$1 AND mime LIKE 'image/%'", [version.json().versionId]);
    await attach(version.json().versionId, newCover.id, 'previews/new.png');
    expect((await summary(id)).skillPreviews[0]).toMatchObject({ versionId: selected.versionId, imageMediaId: oldCover.id });
  });

  it('冻结现有封面且没有素材时冻结空值，后续补传不能改变已建任务', async () => {
    const selected = await skill('冻结封面'); const original = await image(owner, 'original.png');
    await attach(selected.versionId, original.id, 'references/original.png');
    const id = await task([selected]);
    const empty = await skill('没有预览'); const emptyId = await task([empty]);
    const uploaded = await image(owner, 'cover.png');
    await attach(selected.versionId, uploaded.id, 'previews/cover.png');
    await attach(empty.versionId, uploaded.id, 'previews/cover.png');
    expect((await summary(id)).skillPreviews[0].imageMediaId).toBe(original.id);
    expect((await summary(emptyId)).skillPreviews[0]).toMatchObject({ imageMediaId: null, videoMediaId: null });
    const frozen = (await h.db.query('SELECT snapshot FROM tasks WHERE id=$1', [id])).rows[0].snapshot.skills[0].preview;
    expect(frozen).toEqual({ imageMediaId: original.id, videoMediaId: null });
  });

  it('封面优先选择预览目录，不把包内商品图误当成脚本封面', async () => {
    const selected = await skill('封面优先级'); const unrelated = await image(owner, 'cover.png'); const cover = await image(owner, 'shot.png');
    await attach(selected.versionId, unrelated.id, 'assets/cover.png');
    await attach(selected.versionId, cover.id, 'previews/shot.png');
    const id = await task([selected]);
    expect((await summary(id)).skillPreviews[0].imageMediaId).toBe(cover.id);
  });

  it('公共脚本撤销共享后，冻结和历史封面都按当前媒体读取权限隐藏', async () => {
    const selected = await skill('曾共享的脚本', author, 'public'); const cover = await image(author, 'private.png');
    await attach(selected.versionId, cover.id, 'previews/cover.png');
    const frozen = await task([selected]); const legacy = await task([selected]); await makeLegacy(legacy);
    expect((await summary(frozen)).skillPreviews[0].imageMediaId).toBe(cover.id);
    await h.db.query("UPDATE skills SET visibility='private' WHERE id=$1", [selected.id]);
    for (const id of [frozen, legacy]) expect((await summary(id)).skillPreviews[0]).toMatchObject({ imageMediaId: null, videoMediaId: null });
    expect((await h.app.inject({ url: `/api/media/${cover.id}`, headers: owner.headers })).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/task-board', headers: stranger.headers })).json()).toEqual([]);
  });

  it('不返回被误绑定的他人私有素材，也不扩大媒体接口权限', async () => {
    const selected = await skill('私有素材隔离'); const hidden = await image(stranger, 'hidden.png');
    await attach(selected.versionId, hidden.id, 'previews/hidden.png');
    const id = await task([selected]);
    expect((await summary(id)).skillPreviews[0]).toMatchObject({ imageMediaId: null, videoMediaId: null });
    expect((await h.app.inject({ url: `/api/media/${hidden.id}`, headers: owner.headers })).statusCode).toBe(404);
  });

  it('历史列表批量解析封面，不逐卡查库且不暴露正文或原始快照', async () => {
    const selected = await skill('批量任务'); const cover = await image(owner, 'batch.png');
    await attach(selected.versionId, cover.id, 'previews/cover.png');
    const id = await task([selected]); await makeLegacy(id);
    const snapshot = (await h.db.query('SELECT snapshot FROM tasks WHERE id=$1', [id])).rows[0].snapshot;
    await h.db.query("INSERT INTO tasks(id,owner_id,name,snapshot) SELECT gen_random_uuid(),$1,'批量任务 '||n,$2 FROM generate_series(1,30) n", [owner.id, snapshot]);
    const query = vi.spyOn(h.db, 'query');
    const response = await h.app.inject({ url: '/api/task-board', headers: owner.headers });
    const calls = query.mock.calls.length; query.mockRestore();
    expect(response.statusCode).toBe(200);
    expect(response.json().filter((item: { name: string }) => item.name.startsWith('批量任务 '))).toHaveLength(30);
    expect(response.json().find((item: { id: string }) => item.id === id).skillPreviews[0].imageMediaId).toBe(cover.id);
    expect(calls).toBeLessThanOrEqual(6); // Includes authentication, not one query per card.
    expect(response.body).not.toMatch(/正文只保存|snapshot|apiKey|sealedKey|disk_path|"text"/);
  });
});
