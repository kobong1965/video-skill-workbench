import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { claimJob, runJob, recoverExpiredJobs } from '../../apps/worker/queue';
import { ProviderError } from '../../packages/providers/network';

let h: Awaited<ReturnType<typeof harness>>; let a: Awaited<ReturnType<typeof h.account>>; let b: typeof a;
let input: Record<string, unknown>; let taskId: string;
beforeAll(async () => {
  h = await harness('tasks'); a = await h.account('admin'); b = await h.account();
  const media = await saveMedia(h.context, a.id, 'product.png', await sharp({ create: { width: 16, height: 16, channels: 3, background: '#aaa' } }).png().toBuffer());
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '3秒开头', text: '# 开头\n只拍摄三秒', kind: 'opening', duration: 3, visibility: 'private' } })).json();
  input = { name: '只要开头', media: [{ id: media.id, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 30, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 3 }] };
});
afterAll(async () => h.close());
const outputFor = (version: string) => ({ productFacts: [{ text: '灰色', source: 'visible' }], unknowns: ['成分'], conflicts: [], globalPrompt: '自然阳光下的真实手机拍摄，只展示已连接的商品。', shots: [{ skillVersionId: version, duration: 3, title: '开头', prompt: '商品近景，自然光线。', dialogue: '', translation: '', storyAudio: '环境风声', startState: '静止', endState: '停留', references: [] }], assetPlan: [] });
describe('持久任务、额度和恢复', () => {
  it('先保存任务；无 API 不伪造生成结果', async () => {
    const saved = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: input });
    expect(saved.statusCode).toBe(200); taskId = saved.json().id;
    const response = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/generate`, headers: a.headers, payload: { key: randomUUID(), costAccepted: true } });
    expect(response.statusCode).toBe(409); expect(response.json().error).toContain('配置');
    expect((await h.db.query('SELECT count(*) FROM results')).rows[0].count).toBe('0');
  });
  it('跨账号不能打开任务', async () => {
    expect((await h.app.inject({ url: `/api/tasks/${taskId}`, headers: b.headers })).statusCode).toBe(404);
  });
  it('显式配置和额度后，重复提交只排队一次', async () => {
    const config = { enabled: true, baseUrl: 'https://api.example.com/v1', model: 'test-contract-only', apiKey: 'not-a-live-key', vision: true, references: false, multiReference: false, timeoutSeconds: 30, outputHosts: [], jsonMode: true, protocol: 'openai-compatible' };
    expect((await h.app.inject({ method: 'PUT', url: '/api/admin/providers/text', headers: a.headers, payload: config })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'PUT', url: `/api/admin/quotas/${a.id}`, headers: a.headers, payload: { text: 2, image: 0 } })).statusCode).toBe(200);
    const key = randomUUID(); const enqueue = () => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/generate`, headers: a.headers, payload: { key, costAccepted: true } });
    const [first, second] = await Promise.all([enqueue(), enqueue()]);
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200); expect(first.json().id).toBe(second.json().id);
    expect((await h.db.query("SELECT reserved FROM quotas WHERE user_id=$1 AND kind='text'", [a.id])).rows[0].reserved).toBe(1);
  });
  it('两个后台竞争只能领取一次，成功输出立即保存', async () => {
    const [one, two] = await Promise.all([claimJob(h.context), claimJob(h.context)]);
    const job = one ?? two; expect([one, two].filter(Boolean)).toHaveLength(1);
    const selection = (input.selections as { versionId: string }[])[0];
    await runJob(h.context, job!, { text: async () => outputFor(selection.versionId) });
    const detail = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json();
    expect(detail.results).toHaveLength(1); expect(detail.results[0].output.shots[0].duration).toBe(3);
    expect(detail.status).toBe('awaiting_confirmation');
  });
  it('编辑追加版本，确认文字不触发生图', async () => {
    const prior = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json();
    const output = { ...prior.results[0].output, globalPrompt: '阳光增强，保持真实手机拍摄效果。' };
    const saved = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: a.headers, payload: { output } });
    expect(saved.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm`, headers: a.headers, payload: { resultId: saved.json().id } })).statusCode).toBe(200);
    expect((await h.db.query("SELECT count(*) FROM jobs WHERE kind='image'")).rows[0].count).toBe('0');
    expect((await h.db.query('SELECT count(*) FROM results WHERE task_id=$1', [taskId])).rows[0].count).toBe('2');
  });
  it('超时属于未知结果，额度不释放且不能普通重试', async () => {
    const second = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: input })).json();
    await h.app.inject({ method: 'POST', url: `/api/tasks/${second.id}/generate`, headers: a.headers, payload: { key: randomUUID(), costAccepted: true } });
    const job = await claimJob(h.context);
    await runJob(h.context, job!, { text: async () => { throw new ProviderError('unknown', '响应超时，结果待确认'); } });
    expect((await h.db.query('SELECT status FROM jobs WHERE id=$1', [job!.id])).rows[0].status).toBe('unknown');
    expect((await h.db.query("SELECT reserved FROM quotas WHERE user_id=$1 AND kind='text'", [a.id])).rows[0].reserved).toBe(1);
    expect((await h.app.inject({ method: 'POST', url: `/api/jobs/${job!.id}/retry`, headers: a.headers, payload: { costAccepted: true } })).statusCode).toBe(409);
  });
  it('额度耗尽阻止新请求；重启恢复不重复发出已发送请求', async () => {
    const third = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: input })).json();
    expect((await h.app.inject({ method: 'POST', url: `/api/tasks/${third.id}/generate`, headers: a.headers, payload: { key: randomUUID(), costAccepted: true } })).statusCode).toBe(409);
    await h.db.query("UPDATE jobs SET status='running',lease_until=now()-interval '1 minute',sent_at=now() WHERE status='unknown'");
    await recoverExpiredJobs(h.context);
    expect((await h.db.query("SELECT count(*) FROM jobs WHERE status='unknown'")).rows[0].count).toBe('1');
    expect(await claimJob(h.context)).toBe(null);
  });
});
