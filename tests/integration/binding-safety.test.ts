import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { boundAssets } from '../../apps/api/asset-service';

let h: Awaited<ReturnType<typeof harness>>; let a: Awaited<ReturnType<typeof h.account>>; let taskId: string; let resultId: string; let imageId: string;
beforeAll(async () => {
  h = await harness('binding'); a = await h.account('admin');
  imageId = (await saveMedia(h.context, a.id, 'ref.png', await sharp({ create: { width: 12, height: 12, channels: 3, background: '#aaa' } }).png().toBuffer())).id;
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '长片', kind: 'full', duration: 40, text: '# 分批测试' } })).json();
  taskId = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: { name: '引用依赖', media: [{ id: imageId, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 40, model: 'seedance-2.0', generatePerson: true, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 40 }] } })).json().id;
  const output = { productFacts: [], unknowns: [], conflicts: [], globalPrompt: '阳光下保持人物和当前商品一致。', shots: [15, 15, 10].map(duration => ({ skillVersionId: skill.versionId, duration, title: '展示', prompt: '自然展示当前商品。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [imageId] })), assetPlan: [] };
  resultId = (await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: a.headers, payload: { output } })).json().id;
  await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm`, headers: a.headers, payload: { resultId } });
});
afterAll(async () => h.close());
async function asset(kind: string, name: string) { const saved = (await h.app.inject({ method: 'POST', url: '/api/assets', headers: a.headers, payload: { name, kind, mediaId: imageId } })).json(); await h.app.inject({ method: 'POST', url: `/api/assets/${saved.id}/confirm`, headers: a.headers, payload: {} }); return saved.id; }
const bind = (assetId: string, batch?: number) => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/assets`, headers: a.headers, payload: { resultId, assetId, batch, referencesConfirmed: true } });

it('非故事面板不能伪装为只属于第一批的主参考', async () => {
  const person = await asset('person', '主参考');
  expect((await bind(person, 1)).statusCode).toBe(400);
  expect((await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: a.headers, payload: { resultId, kind: 'person', name: '主参考', prompt: '自然摄影人物主参考', key: randomUUID(), costAccepted: true, batch: 1 } })).statusCode).toBe(400);
  expect((await bind(person)).statusCode).toBe(200);
});
it('上传的面板和角度记录当前主参考依赖，换主图后明确失效', async () => {
  const board = await asset('storyboard', '上传面板'); const angle = await asset('angle', '上传侧面');
  expect((await bind(board, 1)).statusCode).toBe(200); expect((await bind(angle)).statusCode).toBe(200);
  expect((await boundAssets(h.context, taskId, resultId)).filter(x => x.kind !== 'person').every(x => !x.stale)).toBe(true);
  await bind(await asset('person', '新的主参考'));
  expect((await boundAssets(h.context, taskId, resultId)).find(x => x.id === board)?.stale).toBe(true);
  expect((await boundAssets(h.context, taskId, resultId)).find(x => x.id === angle)?.stale).toBe(true);
});
it('两个同时衔接请求不能都从旧版覆盖为新版本', async () => {
  const responses = await Promise.all([2, 3].map(nextBatch => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/continuation`, headers: a.headers, payload: { resultId, mediaId: imageId, nextBatch, actualFrameConfirmed: true } })));
  expect(responses.map(x => x.statusCode).sort()).toEqual([200, 409]);
  expect((await h.db.query('SELECT count(*) FROM results WHERE task_id=$1', [taskId])).rows[0].count).toBe('2');
});
