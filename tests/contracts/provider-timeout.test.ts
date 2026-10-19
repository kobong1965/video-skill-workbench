import { afterEach, expect, it, vi } from 'vitest';
import { generateText } from '../../packages/providers/text';
import { generateImage } from '../../packages/providers/image';
import { encryptSecret, type ProviderConfig } from '../../packages/providers/config';
import { requestBytes } from '../../packages/providers/network';
import type { AppContext } from '../../apps/api/context';
import type { TaskSnapshot } from '../../packages/contracts';

vi.mock('../../packages/providers/network', async original => ({ ...await original<typeof import('../../packages/providers/network')>(), requestBytes: vi.fn() }));
vi.mock('../../packages/storage/private-files', () => ({
  ownedMedia: vi.fn(async () => ({ id: 'product', mime: 'image/png', name: 'product.png' })),
  mediaBytes: vi.fn(async () => Buffer.from('fixture-image')),
}));
const request = vi.mocked(requestBytes);
const masterKey = 'a'.repeat(64);
const config: ProviderConfig = { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test', sealedKey: encryptSecret('not-a-real-key', masterKey), vision: true, references: true, multiReference: true, timeoutSeconds: 300, outputHosts: [], jsonMode: true };
const snapshot = { input: { market: 'US', voice: 'none', generatePerson: false, generateScene: false }, media: [], skills: [] } as unknown as TaskSnapshot;
afterEach(() => request.mockReset());

it.each([0, 120, 300])('单人文字请求将旧超时%s改为持续等待', async timeoutSeconds => {
  request.mockResolvedValue(Buffer.from(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
  await generateText({ masterKey, singleUserMode: true } as AppContext, 'owner', snapshot, { ...config, timeoutSeconds });
  expect(request.mock.calls[0][1]?.timeoutSeconds).toBe(0);
  expect(request.mock.calls[0][1]?.singleUserMode).toBe(true);
});

it('单人文字请求保留超过旧范围的明确自定义超时', async () => {
  request.mockResolvedValue(Buffer.from(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
  await generateText({ masterKey, singleUserMode: true } as AppContext, 'owner', snapshot, { ...config, timeoutSeconds: 600 });
  expect(request.mock.calls[0][1]?.timeoutSeconds).toBe(600);
});

it('多人文字请求保留原配置等待时长', async () => {
  request.mockResolvedValue(Buffer.from(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
  await generateText({ masterKey, singleUserMode: false } as AppContext, 'owner', snapshot, { ...config, timeoutSeconds: 120 });
  expect(request.mock.calls[0][1]?.timeoutSeconds).toBe(120);
});

it('单人图片生成也不被旧300秒超时截断', async () => {
  request.mockResolvedValue(Buffer.from(JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] })));
  await expect(generateImage({ masterKey, singleUserMode: true } as AppContext, 'owner', { referenceMediaIds: [], prompt: '自然摄影' }, config)).resolves.toEqual(Buffer.from('image'));
  expect(request.mock.calls[0][1]?.timeoutSeconds).toBe(0);
  expect(request.mock.calls[0][1]?.singleUserMode).toBe(true);
});

it.each([['product'], ['product', 'detail']])('单人参考图请求不被额外能力勾选挡住：%j', async (...referenceMediaIds) => {
  request.mockResolvedValue(Buffer.from(JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] })));
  await generateImage({ masterKey, singleUserMode: true } as AppContext, 'owner', { referenceMediaIds, prompt: '自然摄影' }, { ...config, references: false, multiReference: false });
  expect(request.mock.calls[0][0]).toContain('/images/edits');
  const form = request.mock.calls[0][1]?.body as FormData;
  expect(form.getAll(referenceMediaIds.length > 1 ? 'image[]' : 'image')).toHaveLength(referenceMediaIds.length);
});
