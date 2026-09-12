import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';

let h: Awaited<ReturnType<typeof harness>>;
let a: Awaited<ReturnType<typeof h.account>>;
let b: typeof a;
let mediaId: string;
beforeAll(async () => { h = await harness('media'); a = await h.account(); b = await h.account(); });
afterAll(async () => h.close());
describe('真实媒体与账号隔离', () => {
  it('只存真实校验过的图片，中文文件名持久保存', async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#666' } }).png().toBuffer();
    const media = await saveMedia(h.context, a.id, '商品测试.png', png);
    mediaId = media.id;
    const response = await h.app.inject({ url: `/api/media/${mediaId}`, headers: a.headers });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(png)).toBe(true);
    expect((await h.db.query('SHOW server_encoding')).rows[0].server_encoding).toBe('UTF8');
  });
  it('跨账号和无登录均不能读图片', async () => {
    expect((await h.app.inject({ url: `/api/media/${mediaId}`, headers: b.headers })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/api/media/${mediaId}` })).statusCode).toBe(401);
  });
  it('范围读取同样鉴权且正确处理非法范围', async () => {
    const response = await h.app.inject({ url: `/api/media/${mediaId}`, headers: { ...a.headers, range: 'bytes=0-7' } });
    expect(response.statusCode).toBe(206); expect(response.rawPayload.length).toBe(8);
    expect((await h.app.inject({ url: `/api/media/${mediaId}`, headers: { ...b.headers, range: 'bytes=0-7' } })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/api/media/${mediaId}`, headers: { ...a.headers, range: 'bytes=999999-' } })).statusCode).toBe(416);
  });
  it('拒绝伪图片、脚本和 SVG 活动内容', async () => {
    await expect(saveMedia(h.context, a.id, 'fake.png', Buffer.from('not an image'))).rejects.toThrow();
    await expect(saveMedia(h.context, a.id, 'fake.svg', Buffer.from('<svg onload="alert(1)"/>'))).rejects.toThrow();
  });
});
