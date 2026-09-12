import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
let h: Awaited<ReturnType<typeof harness>>;
let a: Awaited<ReturnType<typeof h.account>>;
let b: typeof a;
let source: string; let skillId: string; let versionId: string;
beforeAll(async () => {
  h = await harness('skills'); a = await h.account('admin'); b = await h.account();
  source = (await saveMedia(h.context, a.id, 'SKILL.md', Buffer.from('# 停车场上衣\n默认17秒全片，自然阳光。'))).id;
});
afterAll(async () => h.close());
describe('脚本导入、原稿与版本', () => {
  it('先预览导入信息，保存时由用户确认', async () => {
    const preview = await h.app.inject({ method: 'POST', url: '/api/skills/inspect', headers: a.headers, payload: { mediaId: source } });
    expect(preview.statusCode).toBe(200); expect(preview.json().suggestedName).toBe('停车场上衣');
    expect((await h.app.inject({ url: '/api/skills', headers: a.headers })).json()).toHaveLength(0);
    const saved = await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { mediaId: source, name: '停车场上衣', kind: 'full', duration: 17, tags: ['阳光'], visibility: 'private', source: '本人已验证' } });
    expect(saved.statusCode).toBe(200); skillId = saved.json().id; versionId = saved.json().versionId;
  });
  it('私有原稿不对其他账号开放', async () => {
    expect((await h.app.inject({ url: '/api/skills', headers: b.headers })).json()).toHaveLength(0);
    expect((await h.app.inject({ url: `/api/skills/${skillId}`, headers: b.headers })).statusCode).toBe(404);
  });
  it('明确更新 ID 产生新版，并保留旧版原文', async () => {
    const response = await h.app.inject({ method: 'POST', url: `/api/skills/${skillId}/versions`, headers: a.headers, payload: { text: '# 第二版\n阳光更明亮。', kind: 'full', duration: 17, source: '调整阳光' } });
    expect(response.statusCode).toBe(200); expect(response.json().versionId).not.toBe(versionId);
    const old = await h.app.inject({ url: `/api/skills/${skillId}?version=${versionId}`, headers: a.headers });
    expect(old.json().text).toContain('默认17秒');
  });
  it('共享需明确确认，成员不能修改公共原版但可另存副本', async () => {
    const response = await h.app.inject({ method: 'PATCH', url: `/api/skills/${skillId}`, headers: a.headers, payload: { name: '停车场上衣', tags: ['阳光'], visibility: 'public', sharingConfirmed: true } });
    expect(response.statusCode).toBe(200);
    expect((await h.app.inject({ url: `/api/skills/${skillId}`, headers: b.headers })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/skills/${skillId}/versions`, headers: b.headers, payload: { text: '侵入改动', kind: 'full', duration: 17 } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: `/api/skills/${skillId}/fork`, headers: b.headers, payload: {} })).statusCode).toBe(200);
  });
  it('草稿按账号存储，不能通过引用别人图片越权', async () => {
    const response = await h.app.inject({ method: 'POST', url: '/api/drafts', headers: a.headers, payload: { name: '未完成输入', input: { extra: '保留这些字', media: [] } } });
    expect(response.statusCode).toBe(200);
    expect((await h.app.inject({ url: '/api/drafts', headers: b.headers })).json()).toHaveLength(0);
    expect((await h.app.inject({ method: 'POST', url: '/api/drafts', headers: b.headers, payload: { name: '越权', input: { media: [{ id: source, role: 'product' }] } } })).statusCode).toBe(404);
  });
});
