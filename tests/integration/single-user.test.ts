import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { claimJob, runJob } from '../../apps/worker/queue';
import { ProviderError } from '../../packages/providers/network';

let h: Awaited<ReturnType<typeof harness>>;
let account: Awaited<ReturnType<typeof h.account>>;
let taskId: string;
let baseInput: Record<string, unknown>;
beforeAll(async () => {
  h = await harness('single_user', undefined, true);
  account = await h.account('admin');
  const media = await saveMedia(h.context, account.id, 'product.png', await sharp({ create: { width: 16, height: 16, channels: 3, background: '#aaa' } }).png().toBuffer());
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: account.headers, payload: { name: '个人测试', text: '# 开头', kind: 'opening', duration: 3 } })).json();
  baseInput = { name: '直接生成', media: [{ id: media.id, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 3, model: 'seedance-2.5', generatePerson: true, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 3 }] };
  const task = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: account.headers, payload: baseInput });
  taskId = task.json().id;
  await h.app.inject({ method: 'PUT', url: '/api/admin/providers/text', headers: account.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'fixture', apiKey: 'fixture-only', vision: false } });
});
afterAll(async () => h.close());

it('单人模式仅配置 API 即可提交，不需要额度、图片能力勾选或费用确认', async () => {
  expect((await h.app.inject({ url: '/api/config', headers: account.headers })).json().singleUserMode).toBe(true);
  const key = randomUUID();
  const submit = () => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/generate`, headers: account.headers, payload: { key } });
  const [a, b] = await Promise.all([submit(), submit()]);
  expect(a.statusCode).toBe(200); expect(b.json().id).toBe(a.json().id);
  expect((await h.db.query('SELECT count(*) FROM usage_ledger')).rows[0].count).toBe('0');
});

it('旧未知任务超过三次也能直接重试，成功后保存原任务结果', async () => {
  const job = await claimJob(h.context);
  expect(job).not.toBeNull();
  await runJob(h.context, job!, { text: async () => { throw new ProviderError('unknown', '连接超时'); } });
  await h.db.query('UPDATE jobs SET attempts=8 WHERE id=$1', [job!.id]);
  const response = await h.app.inject({ method: 'POST', url: `/api/jobs/${job!.id}/retry`, headers: account.headers, payload: {} });
  expect(response.statusCode).toBe(200);
  const retry = await claimJob(h.context);
  const version = (await h.db.query('SELECT snapshot FROM tasks WHERE id=$1', [taskId])).rows[0].snapshot.skills[0].versionId;
  await runJob(h.context, retry!, { text: async () => ({ productFacts: [], unknowns: [], conflicts: [], globalPrompt: '按当前商品图与自然场景展示产品。', shots: [{ skillVersionId: version, duration: 3, title: '开头', prompt: '商品近景自然展示。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [] }], assetPlan: [] }) });
  expect((await h.db.query('SELECT status FROM jobs WHERE id=$1', [job!.id])).rows[0].status).toBe('succeeded');
  expect((await h.db.query('SELECT count(*) FROM results WHERE task_id=$1', [taskId])).rows[0].count).toBe('1');
  expect((await h.db.query('SELECT count(*) FROM usage_ledger')).rows[0].count).toBe('0');
});

it('图片无费用确认也可生成，旧额度值不变，invalid 可直接重试', async () => {
  const quota = { reserved: 7, used: 12 };
  await h.db.query("INSERT INTO quotas(user_id,kind,allowance,used,reserved) VALUES($1,'image',0,$2,$3)", [account.id, quota.used, quota.reserved]);
  await h.app.inject({ method: 'PUT', url: '/api/admin/providers/image', headers: account.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'fixture', apiKey: 'fixture-only', references: true, multiReference: true } });
  const result = (await h.db.query('SELECT id FROM results WHERE task_id=$1', [taskId])).rows[0];
  await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm`, headers: account.headers, payload: { resultId: result.id } });
  const response = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: account.headers, payload: { resultId: result.id, kind: 'person', name: '人物参考', prompt: '依据当前商品图制作真实人物参考。', key: randomUUID() } });
  expect(response.statusCode).toBe(200);
  const job = await claimJob(h.context);
  await runJob(h.context, job!, { image: async () => { throw new ProviderError('invalid', '图片格式需修正'); } });
  expect((await h.app.inject({ method: 'POST', url: `/api/jobs/${job!.id}/retry`, headers: account.headers, payload: {} })).statusCode).toBe(200);
  const retry = await claimJob(h.context);
  await runJob(h.context, retry!, { image: async () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#abc' } }).png().toBuffer() });
  expect((await h.db.query('SELECT status FROM jobs WHERE id=$1', [job!.id])).rows[0].status).toBe('succeeded');
  expect((await h.db.query("SELECT used,reserved FROM quotas WHERE user_id=$1 AND kind='image'", [account.id])).rows[0]).toEqual(quota);
  expect((await h.db.query('SELECT count(*) FROM usage_ledger')).rows[0].count).toBe('0');
});

it('旧 unknown 不挡新提交；不同 key 并发仍只排一次，旧任务不能同时重发', async () => {
  const task = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: account.headers, payload: baseInput })).json();
  await h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/generate`, headers: account.headers, payload: { key: randomUUID() } });
  const old = await claimJob(h.context);
  await runJob(h.context, old!, { text: async () => { throw new ProviderError('unknown', '测试连接中断'); } });
  const submit = () => h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/generate`, headers: account.headers, payload: { key: randomUUID() } });
  const results = await Promise.all([submit(), submit()]);
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
  expect((await h.app.inject({ method: 'POST', url: `/api/jobs/${old!.id}/retry`, headers: account.headers, payload: {} })).statusCode).toBe(409);
});
