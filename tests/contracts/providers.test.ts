import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { claimJob, runJob } from '../../apps/worker/queue';
import { ProviderError, requestBytes } from '../../packages/providers/network';
import { generateImage } from '../../packages/providers/image';
import { getProvider } from '../../packages/providers/config';

vi.mock('../../packages/providers/network', async importOriginal => ({ ...await importOriginal<typeof import('../../packages/providers/network')>(), requestBytes: vi.fn() }));
let h: Awaited<ReturnType<typeof harness>>; let a: Awaited<ReturnType<typeof h.account>>; let imageId: string; let versionId: string; let skillId: string;
const request = vi.mocked(requestBytes);
beforeAll(async () => {
  h = await harness('provider_contract'); a = await h.account('admin');
  imageId = (await saveMedia(h.context, a.id, 'product.png', await sharp({ create: { width: 16, height: 16, channels: 3, background: '#999' } }).png().toBuffer())).id;
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '合同测试脚本', kind: 'full', duration: 10, text: '# 当前商品自然展示' } })).json(); skillId = skill.id; versionId = skill.versionId;
  for (const kind of ['image', 'text']) await h.app.inject({ method: 'PUT', url: `/api/admin/providers/${kind}`, headers: a.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: `contract-${kind}`, apiKey: 'contract-secret', references: true, multiReference: true, vision: true, outputHosts: ['cdn.example.com'] } });
  await h.app.inject({ method: 'PUT', url: `/api/admin/quotas/${a.id}`, headers: a.headers, payload: { text: 10, image: 10 } });
});
afterAll(async () => h.close()); afterEach(() => request.mockReset());
async function task() { return (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: { name: '接口合同测试', media: [{ id: imageId, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 10, model: 'seedance-2.5', generatePerson: true, generateScene: false, voice: 'none', selections: [{ id: skillId, versionId, duration: 10 }] } })).json().id as string; }
const output = () => ({ productFacts: [], unknowns: [], conflicts: [], globalPrompt: '阳光与微风，商品按当前图片，不继承海报背景。', shots: [{ skillVersionId: versionId, duration: 10, title: '展示', prompt: '自然阳光下展示产品。', dialogue: '', translation: '', storyAudio: '微风', startState: '', endState: '', references: [imageId] }], assetPlan: [] });

it('图片 POST 成功但 GET 被拒绝，记已用额度并提示再次生成费用', async () => {
  const id = await task();
  const resultId = (await h.app.inject({ method: 'POST', url: `/api/tasks/${id}/results`, headers: a.headers, payload: { output: output() } })).json().id;
  await h.app.inject({ method: 'POST', url: `/api/tasks/${id}/confirm`, headers: a.headers, payload: { resultId } });
  await h.app.inject({ method: 'POST', url: `/api/tasks/${id}/images`, headers: a.headers, payload: { resultId, kind: 'person', name: '主图', prompt: '当前商品的人物自然摄影参考图', costAccepted: true, key: randomUUID() } });
  request.mockImplementationOnce(async (_url, options) => { await options?.onDispatch?.(); return Buffer.from(JSON.stringify({ data: [{ url: 'https://cdn.example.com/picture.png?signature=test-only' }] })); }).mockRejectedValueOnce(new ProviderError('rejected', '下载 403'));
  const job = (await claimJob(h.context))!; await runJob(h.context, job);
  const state = (await h.db.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0]; expect(state.status).toBe('invalid');
  const quota = (await h.db.query("SELECT used,reserved FROM quotas WHERE user_id=$1 AND kind='image'", [a.id])).rows[0]; expect(quota).toEqual({ used: 1, reserved: 0 });
  expect(request.mock.calls[0][0]).toContain('/images/edits'); expect(request.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  expect(request.mock.calls[1][1]?.headers).toBeUndefined(); // No API key is forwarded to signed output URLs.
  expect((await h.db.query("SELECT 1 FROM usage_ledger WHERE job_id=$1 AND action='rejected_release'", [job.id])).rowCount).toBe(0);
  expect((await h.app.inject({ method: 'POST', url: `/api/jobs/${job.id}/retry`, headers: a.headers, payload: { costAccepted: true } })).statusCode).toBe(409);
});

it('本机图片丢失时没有发出 HTTP 请求，也不预留未知费用', async () => {
  const id = await task(); await h.app.inject({ method: 'POST', url: `/api/tasks/${id}/generate`, headers: a.headers, payload: { key: randomUUID(), costAccepted: true } });
  const original = path.join(h.context.dataRoot, 'media', imageId); const temporary = `${original}.test-recovery`;
  await rename(original, temporary);
  try { await runJob(h.context, (await claimJob(h.context))!); } finally { await rename(temporary, original); }
  expect(request).not.toHaveBeenCalled();
  expect((await h.db.query('SELECT status,sent_at FROM jobs WHERE task_id=$1', [id])).rows[0]).toEqual({ status: 'failed', sent_at: null });
  expect((await h.db.query("SELECT used,reserved FROM quotas WHERE user_id=$1 AND kind='text'", [a.id])).rows[0]).toEqual({ used: 0, reserved: 0 });
});

it('文字接口实际发送结构包含图片和中文边界，成功结构可持久化', async () => {
  const id = await task(); await h.app.inject({ method: 'POST', url: `/api/tasks/${id}/generate`, headers: a.headers, payload: { key: randomUUID(), costAccepted: true } });
  request.mockImplementationOnce(async (_url, options) => { await options?.onDispatch?.(); return Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output()) } }] })); });
  const job = (await claimJob(h.context))!; await runJob(h.context, job);
  const body = JSON.parse(request.mock.calls[0][1]?.body as string);
  expect(body.model).toBe('contract-text'); expect(body.messages[1].content.some((x: { type: string }) => x.type === 'image_url')).toBe(true); expect(body.response_format.type).toBe('json_object');
  expect((await h.db.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status).toBe('succeeded');
  expect((await h.db.query('SELECT provider FROM attempts WHERE job_id=$1', [job.id])).rows[0].provider.model).toBe('contract-text');
});

it('参考图能力不足时，在生图 POST 之前拒绝', async () => {
  const config = (await getProvider(h.context, 'image'))!;
  await expect(generateImage(h.context, a.id, { referenceMediaIds: [imageId], prompt: '产品图' }, { ...config, references: false })).rejects.toThrow('参考图');
  expect(request).not.toHaveBeenCalled();
});
