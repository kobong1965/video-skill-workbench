import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { claimJob, runJob } from '../../apps/worker/queue';
import { ProviderError } from '../../packages/providers/network';
import type { CreationInput, PromptOutput, TaskSummary } from '../../packages/contracts';

let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let other: typeof owner;
let input: CreationInput;
beforeAll(async () => {
  h = await harness('task_board', undefined, true);
  owner = await h.account('admin'); other = await h.account();
  const media = await saveMedia(h.context, owner.id, 'product.png', await sharp({ create: { width: 16, height: 16, channels: 3, background: '#abc' } }).png().toBuffer());
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: owner.headers, payload: { name: '任务栏测试', text: '# 3秒展示', kind: 'opening', duration: 3 } })).json();
  input = { name: '后台生成', media: [{ id: media.id, role: 'product' }], platform: 'tiktok', market: 'US', category: '服装', targetDuration: 3, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 3 }], productName: '', facts: '', audience: '', personNotes: '', sceneNotes: '', extra: '' };
  await h.app.inject({ method: 'PUT', url: '/api/admin/providers/text', headers: owner.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'fixture', apiKey: 'fixture-only', vision: true } });
});
afterAll(async () => h.close());
async function create(name: string) {
  const response = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: owner.headers, payload: { ...input, name } });
  expect(response.statusCode).toBe(200);
  return response.json().id as string;
}
async function enqueue(id: string) {
  const response = await h.app.inject({ method: 'POST', url: `/api/tasks/${id}/generate`, headers: owner.headers, payload: { key: randomUUID() } });
  expect(response.statusCode).toBe(200);
  return response.json().id as string;
}
async function board() {
  const response = await h.app.inject({ url: '/api/task-board', headers: owner.headers });
  expect(response.statusCode).toBe(200);
  return response.json() as TaskSummary[];
}
function output(): PromptOutput {
  return { productFacts: [], unknowns: [], conflicts: [], globalPrompt: '真实自然摄影，展示当前商品和自然动作。', shots: [{ skillVersionId: input.selections[0].versionId, duration: 3, title: '展示', prompt: '自然近景展示商品。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [input.media[0].id] }], assetPlan: [] };
}

describe('持久任务栏', () => {
  it('只返回当前账号，未开始与已排队的任务包含商品缩略图且不包含密钥', async () => {
    const draftId = await create('未开始');
    const queuedId = await create('等待后台');
    const jobId = await enqueue(queuedId);
    const tasks = await board();
    expect(tasks.find(x => x.id === draftId)).toMatchObject({ status: 'draft', activeJobs: 0, latestJob: null, latestResultId: null, progress: { stage: 'draft', value: 0 } });
    expect(tasks.find(x => x.id === queuedId)).toMatchObject({ thumbnailMediaId: input.media[0].id, activeJobs: 1, latestJob: { id: jobId, kind: 'text', status: 'queued' }, progress: { stage: 'queued', value: 0 } });
    expect(tasks.every(x => Number.isFinite(Date.parse(x.updatedAt)))).toBe(true);
    expect(tasks.every(x => Date.parse(x.updatedAt) >= Date.parse(x.createdAt))).toBe(true);
    expect(JSON.stringify(tasks)).not.toMatch(/sealedKey|apiKey|fixture-only/);
    expect((await h.app.inject({ url: '/api/task-board', headers: other.headers })).json()).toEqual([]);
    expect((await h.app.inject({ url: '/api/task-board' })).statusCode).toBe(401);
    const legacy = (await h.app.inject({ url: '/api/tasks', headers: owner.headers })).json();
    expect(legacy.find((x: TaskSummary) => x.id === queuedId)).toMatchObject({ id: queuedId, name: '等待后台', status: 'queued', parentId: null });
  });

  it('离开页面后请求仍在运行，等待上游不伪造百分比，保存后才标记完成', async () => {
    const task = (await board()).find(x => x.name === '等待后台')!;
    const job = await claimJob(h.context);
    expect(job?.task_id).toBe(task.id);
    expect((await board()).find(x => x.id === task.id)?.progress).toMatchObject({ stage: 'preparing', value: null });
    let finish!: (value: PromptOutput) => void;
    const response = new Promise<PromptOutput>(resolve => { finish = resolve; });
    let entered!: () => void;
    const dispatched = new Promise<void>(resolve => { entered = resolve; });
    const running = runJob(h.context, job!, { text: async () => { entered(); return response; } });
    await dispatched;
    expect((await board()).find(x => x.id === task.id)).toMatchObject({ activeJobs: 1, latestResultId: null, progress: { stage: 'waiting', value: null } });
    const detail = (await h.app.inject({ url: `/api/tasks/${task.id}`, headers: owner.headers })).json();
    expect(detail.jobs[0].progress).toMatchObject({ stage: 'waiting', value: null });
    finish(output()); await running;
    const done = (await board()).find(x => x.id === task.id)!;
    expect(done).toMatchObject({ status: 'awaiting_confirmation', activeJobs: 0, latestJob: { status: 'succeeded', attempts: 1 }, progress: { stage: 'ready', value: 100 } });
    expect(done.latestResultId).toBeTruthy();
    expect(Date.parse(done.updatedAt)).toBeGreaterThanOrEqual(Date.parse(task.updatedAt));
  });

  it('两个后台任务相互独立，失败只显示该任务错误，另一个任务继续保存成功结果', async () => {
    const firstId = await create('独立任务 A'); const secondId = await create('独立任务 B');
    await enqueue(firstId); await enqueue(secondId);
    const jobs = await Promise.all([claimJob(h.context), claimJob(h.context)]);
    expect(new Set(jobs.map(x => x?.task_id))).toEqual(new Set([firstId, secondId]));
    await Promise.all(jobs.map(job => runJob(h.context, job!, { text: async () => { if (job!.task_id === firstId) throw new ProviderError('unknown', '测试响应中断'); return output(); } })));
    const tasks = await board();
    expect(tasks.find(x => x.id === firstId)).toMatchObject({ status: 'unknown', activeJobs: 0, latestJob: { error: '测试响应中断' }, latestResultId: null, progress: { stage: 'unknown', value: null } });
    expect(tasks.find(x => x.id === secondId)).toMatchObject({ status: 'awaiting_confirmation', progress: { stage: 'ready', value: 100 } });
  });

  it('重试复用旧作业时恢复排队显示，并保留最新有效结果版本', async () => {
    const failed = (await board()).find(x => x.name === '独立任务 A')!;
    expect((await h.app.inject({ method: 'POST', url: `/api/jobs/${failed.latestJob!.id}/retry`, headers: owner.headers, payload: {} })).statusCode).toBe(200);
    expect((await board()).find(x => x.id === failed.id)).toMatchObject({ activeJobs: 1, progress: { stage: 'queued', value: 0 } });
    await runJob(h.context, (await claimJob(h.context))!, { text: async () => output() });
    const previous = (await board()).find(x => x.id === failed.id)!;
    const saved = await h.app.inject({ method: 'POST', url: `/api/tasks/${failed.id}/results`, headers: owner.headers, payload: { output: { ...output(), globalPrompt: '已编辑的提示词，自然动作及真实商品展示。' } } });
    const current = (await board()).find(x => x.id === failed.id)!;
    expect(current.latestResultId).toBe(saved.json().id); expect(current.latestResultId).not.toBe(previous.latestResultId);
    expect(Date.parse(current.updatedAt)).toBeGreaterThanOrEqual(Date.parse(previous.updatedAt));
  });

  it('只返回最近100条轻量概况，完整历史接口继续兼容最多200条', async () => {
    const snapshot = (await h.db.query('SELECT snapshot FROM tasks LIMIT 1')).rows[0].snapshot;
    await h.db.query(`INSERT INTO tasks(id,owner_id,name,snapshot,created_at)
      SELECT gen_random_uuid(),$1,'历史任务 '||n,$2,now()-n*interval '1 minute'
      FROM generate_series(1,110) n`, [owner.id, snapshot]);
    const tasks = await board();
    expect(tasks).toHaveLength(100);
    expect(tasks.map(x => x.createdAt)).toEqual(tasks.map(x => x.createdAt).sort().reverse());
    expect(tasks.some(x => x.name === '历史任务 110')).toBe(false);
    const legacy = (await h.app.inject({ url: '/api/tasks', headers: owner.headers })).json();
    expect(legacy).toHaveLength(114);
    expect(JSON.stringify(tasks)).not.toMatch(/globalPrompt|fixture-only|snapshot|sealedKey|baseUrl|apiKey|frozenProvider/);
    for (const task of tasks) if (task.latestJob?.provider) expect(Object.keys(task.latestJob.provider).sort()).toEqual(['id', 'model', 'name']);
  });
});
