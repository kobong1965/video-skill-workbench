import { expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareVisionImage, assertTextRequestBytes, MAX_TEXT_REQUEST_BYTES } from '../../packages/providers/vision-input';
import { buildTextRequest } from '../../packages/providers/text';
import type { TaskSnapshot } from '../../packages/contracts';

it('大图生成有限尺寸分析副本，原素材字节不变；小图保留原格式', async () => {
  const original = await sharp({ create: { width: 3000, height: 2400, channels: 3, background: '#4267a0' } }).png().toBuffer();
  const copy = Buffer.from(original);
  const prepared = await prepareVisionImage(original, 'image/png');
  const metadata = await sharp(prepared.bytes).metadata();
  expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1600);
  expect(prepared.bytes.length).toBeLessThanOrEqual(512 * 1024);
  expect(original).toEqual(copy);
  const small = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#999' } }).png().toBuffer();
  expect(await prepareVisionImage(small, 'image/png')).toEqual({ mime: 'image/png', bytes: small });
});

it('按完整UTF8体积检查请求，上限是本地预检而非发出后失败', () => {
  expect(() => assertTextRequestBytes(MAX_TEXT_REQUEST_BYTES)).not.toThrow();
  expect(() => assertTextRequestBytes(MAX_TEXT_REQUEST_BYTES + 1)).toThrow('请求体');
});

it('AI逐图说明款号与用途，三种模式有明确约束，超大图片在base64展开前拒绝', () => {
  const base = { input: { market: 'US', voice: 'none', productUse: 'comparison', productGroups: [
    { productSetId: 's1', styleNumber: '6258黑色', name: '主商品', mediaIds: ['a'] },
    { productSetId: 's2', styleNumber: '6121', name: '对比商品', mediaIds: ['b'] },
  ] }, media: [], skills: [] } as unknown as TaskSnapshot;
  const messages = buildTextRequest(base, [{ id: 'a', role: 'product', mime: 'image/png', bytes: Buffer.from('test') }, { id: 'b', role: 'comparison', mime: 'image/png', bytes: Buffer.from('test') }]);
  const text = JSON.stringify(messages);
  expect(text).toContain('6258黑色'); expect(text).toContain('6121');
  expect(text).toContain('组1'); expect(text).toContain('组2'); expect(text).toContain('主商品'); expect(text).toContain('对比商品');
  expect(text).toContain('换色'); expect(text).toContain('搭配'); expect(text).toContain('references');
  expect(() => buildTextRequest(base, [{ id: 'huge', role: 'product', mime: 'image/png', bytes: Buffer.alloc(MAX_TEXT_REQUEST_BYTES) }])).toThrow('请求体');
});
