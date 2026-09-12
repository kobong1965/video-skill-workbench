import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { claimJob, runJob } from '../../apps/worker/queue';

let h: Awaited<ReturnType<typeof harness>>; let a: Awaited<ReturnType<typeof h.account>>; let b: typeof a;
let taskId: string; let resultId: string; let imageId: string; let masterId: string; let png: Buffer;
beforeAll(async () => {
  h = await harness('assets'); a = await h.account('admin'); b = await h.account();
  png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#888' } }).png().toBuffer();
  imageId = (await saveMedia(h.context, a.id, '商品.png', png)).id;
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '全片', text: '# 完整镜头', kind: 'full', duration: 30 } })).json();
  const input = { name: '长片图片验收', media: [{ id: imageId, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 30, model: 'seedance-2.0', generatePerson: true, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 30 }] };
  taskId = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: input })).json().id;
  const output = { productFacts: [], unknowns: [], conflicts: [], globalPrompt: '保持同一商品和场景，真实自然阳光下拍摄。', shots: [1, 2].map(i => ({ skillVersionId: skill.versionId, duration: 15, title: `镜头${i}`, prompt: '在阳光下展示参考商品', dialogue: '', translation: '', storyAudio: '微风', startState: '站立', endState: '停留', references: [imageId] })), assetPlan: [] };
  resultId = (await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: a.headers, payload: { output } })).json().id;
  await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm`, headers: a.headers, payload: { resultId } });
  await h.app.inject({ method: 'PUT', url: '/api/admin/providers/image', headers: a.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'test-not-live', model: 'contract-test', references: true, multiReference: true, vision: false } });
  await h.app.inject({ method: 'PUT', url: `/api/admin/quotas/${a.id}`, headers: a.headers, payload: { text: 0, image: 10 } });
});
afterAll(async () => h.close());
describe('可选图片、单张确认与真实导出', () => {
  it('主图未确认前不能派生角度，不授权不请求', async () => {
    const request = { resultId, kind: 'person', name: '人物主图', prompt: '年轻成年女生，真实自然摄影', key: randomUUID(), costAccepted: false };
    expect((await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: a.headers, payload: request })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: a.headers, payload: { ...request, costAccepted: true, kind: 'angle' } })).statusCode).toBe(409);
  });
  it('图片完成后仍需人工确认，再基于同一主图派生', async () => {
    const result = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: a.headers, payload: { resultId, kind: 'person', name: '人物主图', prompt: '年轻成年女生，真实自然摄影', key: randomUUID(), costAccepted: true } });
    expect(result.statusCode).toBe(200);
    await runJob(h.context, (await claimJob(h.context))!, { image: async () => png });
    const assets = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json().assets;
    masterId = assets[0].id; expect(assets[0].confirmed).toBe(false);
    expect((await h.app.inject({ method: 'POST', url: `/api/assets/${masterId}/confirm`, headers: b.headers, payload: {} })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: `/api/assets/${masterId}/confirm`, headers: a.headers, payload: {} })).statusCode).toBe(200);
    const angle = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: a.headers, payload: { resultId, kind: 'angle', parentId: masterId, name: '人物侧面', prompt: '同一人物的侧面参考照', key: randomUUID(), costAccepted: true } });
    expect(angle.statusCode).toBe(200);
    const job = (await claimJob(h.context))!;
    expect(job.payload.parentId).toBe(masterId); expect((job.payload.referenceMediaIds as string[]).length).toBeGreaterThan(1);
    await runJob(h.context, job, { image: async () => png });
  });
  it('缺故事面板仍可导出文字包，但不冒充完整包', async () => {
    expect((await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/export`, headers: a.headers, payload: { resultId, complete: true } })).statusCode).toBe(409);
    const partial = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/export`, headers: a.headers, payload: { resultId, complete: false } });
    expect(partial.statusCode).toBe(200); expect(partial.json().complete).toBe(false);
    const download = await h.app.inject({ url: `/api/exports/${partial.json().id}`, headers: a.headers });
    expect(download.statusCode).toBe(200);
    const files = unzipSync(download.rawPayload);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.batches).toHaveLength(2); expect(manifest.missing.length).toBeGreaterThan(0);
    expect(strFromU8(files['batches/02-prompt.txt'])).toContain('保持同一商品');
    expect(JSON.stringify(manifest)).not.toContain('test-not-live');
    expect((await h.app.inject({ url: `/api/exports/${partial.json().id}`, headers: b.headers })).statusCode).toBe(404);
  });
  it('实际尾帧产生后续批次的新修订，旧稿保留', async () => {
    const response = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/continuation`, headers: a.headers, payload: { resultId, mediaId: imageId, nextBatch: 2, actualFrameConfirmed: true } });
    expect(response.statusCode).toBe(200); expect(response.json().id).not.toBe(resultId);
    const detail = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json();
    expect(detail.results).toHaveLength(2); expect(detail.results[0].output.shots[1].prompt).toContain('真实尾帧');
    expect(detail.results[1].output.shots[1].prompt).not.toContain('真实尾帧');
  });
});
