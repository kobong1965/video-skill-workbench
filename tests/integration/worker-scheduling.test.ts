import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, type Database } from '../../packages/storage/database';
import type { AppContext } from '../../apps/api/context';
import { claimJob, recoverExpiredJobs, runJob } from '../../apps/worker/queue';
import type { ProviderConfig } from '../../packages/providers/config';

let h: { db: Database; context: AppContext; close: () => Promise<void> };
let ownerId: string;
const versionId = randomUUID();
const snapshot = {
  input: { voice: 'none', market: 'US', generatePerson: false, generateScene: false },
  skills: [{ id: randomUUID(), versionId, name: '调度测试', kind: 'full', duration: 3, text: '只展示当前商品' }],
  media: [], capability: { min: 1, max: 30 },
};
const output = () => ({ productFacts: [], unknowns: [], conflicts: [], globalPrompt: '当前商品的自然展示。', shots: [{ skillVersionId: versionId, duration: 3, title: '展示', prompt: '只展示本次商品。', dialogue: '', translation: '', storyAudio: '', startState: '站定', endState: '停留', references: [] }], assetPlan: [] });
function provider(id: string, maxConcurrency = 1, extra: Record<string, unknown> = {}) {
  return { id, name: id, enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: id, sealedKey: 'isolated-fixture-no-live-key', vision: true, references: true, multiReference: true, timeoutSeconds: 30, outputHosts: [], jsonMode: true, maxConcurrency, ...extra } as ProviderConfig;
}
async function setting(key: string, value: unknown) {
  await h.db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)]);
}
async function enqueue(kind: 'text' | 'image', config: ProviderConfig, payload: Record<string, unknown> = {}) {
  const taskId = randomUUID(), id = randomUUID();
  await h.db.query('INSERT INTO tasks(id,owner_id,name,snapshot) VALUES($1,$2,$3,$4)', [taskId, ownerId, '隔离调度测试', snapshot]);
  await h.db.query('INSERT INTO jobs(id,task_id,owner_id,kind,submit_key,provider,payload) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, taskId, ownerId, kind, randomUUID(), config, payload]);
  return { id, taskId };
}
const auto = (config = provider('submit-time-placeholder', 4)) => ({ ...config, routing: 'auto' }) as ProviderConfig;
beforeAll(async () => {
  const schema = `vsw_worker_scheduling_${randomUUID().replaceAll('-', '')}`;
  const base = createDatabase(process.env.VSW_DATABASE_URL!);
  await base.query(`CREATE SCHEMA "${schema}"`); await base.end();
  const url = new URL(process.env.VSW_DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = createDatabase(url.toString()); await migrate(db);
  const context: AppContext = { db, dataRoot: process.env.VSW_TEST_ROOT!, masterKey: 'a'.repeat(64), setupKey: 'isolated-fixture', origin: 'http://127.0.0.1:4178', singleUserMode: true };
  h = { db, context, close: async () => { await db.end(); } };
  ownerId = randomUUID();
  await db.query("INSERT INTO users(id,username,display_name,password_hash,role) VALUES($1,$2,'调度测试','not-used-in-this-suite','admin')", [ownerId, ownerId]);
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.db.query('TRUNCATE TABLE tasks CASCADE');
  await h.db.query('DELETE FROM settings');
});

describe('数据库原子调度与接口槽位', () => {
  it('多个后台同时领取时，每接口限额和同一步骤唯一领取均生效；等待不占租约或attempt', async () => {
    await setting('provider-pool.text', [provider('one', 1), provider('two', 2)]);
    for (let i = 0; i < 12; i++) await enqueue('text', auto());
    const jobs = (await Promise.all(Array.from({ length: 12 }, () => claimJob(h.context)))).filter(Boolean);
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map(job => job!.id)).size).toBe(3);
    expect(jobs.filter(job => (job!.provider as unknown as { id: string }).id === 'one')).toHaveLength(1);
    expect(jobs.filter(job => (job!.provider as unknown as { id: string }).id === 'two')).toHaveLength(2);
    const waiting = (await h.db.query("SELECT count(*)::integer AS count FROM jobs WHERE status='queued' AND lease_token IS NULL AND lease_until IS NULL AND attempts=0")).rows[0];
    expect(waiting.count).toBe(9);
    expect((await h.db.query('SELECT count(*)::integer AS count FROM attempts')).rows[0].count).toBe(0);
  });

  it('文字与图片共享全局并发上限，跨后台竞争不能各自占满', async () => {
    await setting('execution', { maxConcurrentJobs: 2 });
    await setting('provider-pool.text', [provider('text', 4)]);
    await setting('provider-pool.image', [provider('image', 4)]);
    for (let i = 0; i < 6; i++) await enqueue(i % 2 ? 'image' : 'text', auto());
    const claimed = await Promise.all(Array.from({ length: 8 }, () => claimJob(h.context)));
    expect(claimed.filter(Boolean)).toHaveLength(2);
  });

  it('队首冻结接口已满时，继续领取后面另一个空闲接口的步骤', async () => {
    await setting('provider-pool.text', [provider('available', 1)]);
    const frozen = provider('busy', 1);
    await enqueue('text', frozen);
    const first = await claimJob(h.context);
    expect(first).not.toBeNull();
    const blocked = await enqueue('text', frozen);
    const runnable = await enqueue('text', auto());
    expect((await claimJob(h.context))?.id).toBe(runnable.id);
    expect((await h.db.query('SELECT status,lease_token FROM jobs WHERE id=$1', [blocked.id])).rows[0]).toEqual({ status: 'queued', lease_token: null });
  });

  it('旧版无接口id的冻结配置仍执行原快照，并与legacy槽统一计数', async () => {
    const { id: _id, name: _name, ...legacy } = provider('old-model', 1);
    await setting('provider-pool.text', [provider('legacy-text', 1, { model: 'edited-disabled', enabled: false })]);
    const old = await enqueue('text', legacy as ProviderConfig);
    const job = await claimJob(h.context);
    expect(job?.id).toBe(old.id);
    expect(job?.provider.model).toBe('old-model');
    const next = await enqueue('text', { ...legacy, id: 'legacy-text' } as ProviderConfig);
    expect(await claimJob(h.context)).toBeNull();
    expect((await h.db.query('SELECT status FROM jobs WHERE id=$1', [next.id])).rows[0].status).toBe('queued');
  });

  it('同id冻结旧请求仍服从当前并发上限，不会被旧快照较大容量超卖', async () => {
    await setting('provider-pool.text', [provider('shared', 1)]);
    const first = await enqueue('text', provider('shared', 4, { model: 'old-model' }));
    await enqueue('text', auto());
    expect((await claimJob(h.context))?.id).toBe(first.id);
    expect(await claimJob(h.context)).toBeNull();
  });

  it('旧队首连续满槽超过一页时仍可找到后面的可执行步骤', async () => {
    await setting('provider-pool.text', [provider('busy', 1), provider('available', 1)]);
    await enqueue('text', provider('busy', 1));
    await claimJob(h.context);
    for (let i = 0; i < 65; i++) await enqueue('text', provider('busy', 1));
    const available = await enqueue('text', provider('available', 1));
    expect((await claimJob(h.context))?.id).toBe(available.id);
  });

  it('接口同时空闲时轮转分配，已完成请求不永久偏向列表首项', async () => {
    await setting('provider-pool.text', [provider('one', 1), provider('two', 1)]);
    await enqueue('text', auto());
    const first = await claimJob(h.context);
    await h.db.query("UPDATE jobs SET status='succeeded' WHERE id=$1", [first!.id]);
    await enqueue('text', auto());
    const second = await claimJob(h.context);
    expect(second?.provider.id).not.toBe(first?.provider.id);
  });

  it('领取时选择当前可用接口，领取后编辑或禁用配置不改变执行及attempt快照', async () => {
    await setting('provider-pool.text', [provider('current', 1, { model: 'model-at-claim' })]);
    const queued = await enqueue('text', auto(provider('outdated', 1)));
    const job = await claimJob(h.context);
    expect(job?.id).toBe(queued.id);
    expect(job?.provider.model).toBe('model-at-claim');
    expect(job?.provider).not.toHaveProperty('routing');
    await setting('provider-pool.text', [provider('current', 1, { model: 'edited-later', enabled: false })]);
    await runJob(h.context, job!, { text: async () => output() });
    const attempt = (await h.db.query('SELECT status,provider FROM attempts WHERE job_id=$1', [queued.id])).rows[0];
    expect(attempt.status).toBe('succeeded');
    expect(attempt.provider.model).toBe('model-at-claim');
  });

  it('多参考图片只分配兼容接口，并跳过不兼容步骤继续其他任务', async () => {
    h.context.singleUserMode = false;
    try {
      await setting('provider-pool.image', [provider('no-reference', 1, { references: false, multiReference: false }), provider('one-reference', 1, { multiReference: false }), provider('multi-reference', 1)]);
      await enqueue('image', auto(), { referenceMediaIds: ['product', 'detail'] });
      const job = await claimJob(h.context);
      expect((job?.provider as unknown as { id: string }).id).toBe('multi-reference');
      await enqueue('image', auto(), { referenceMediaIds: ['product', 'detail'] });
      const text = await enqueue('text', provider('frozen-text', 1));
      expect((await claimJob(h.context))?.id).toBe(text.id);
    } finally { h.context.singleUserMode = true; }
  });

  it('已发送或unknown步骤不会被自动重新领取到其他接口', async () => {
    await setting('provider-pool.text', [provider('new-interface', 2)]);
    const unknown = await enqueue('text', auto());
    const sent = await enqueue('text', auto());
    await h.db.query("UPDATE jobs SET status='unknown',sent_at=now() WHERE id=$1", [unknown.id]);
    await h.db.query('UPDATE jobs SET sent_at=now() WHERE id=$1', [sent.id]);
    const safe = await enqueue('text', auto());
    expect((await claimJob(h.context))?.id).toBe(safe.id);
    expect(await claimJob(h.context)).toBeNull();
  });

  it('过期已发送任务只转unknown；本地未发送步骤可恢复，旧租约不可写结果', async () => {
    const old = await enqueue('text', provider('frozen', 2));
    const sent = await claimJob(h.context);
    const local = await enqueue('text', provider('frozen', 2));
    const unsent = await claimJob(h.context);
    await h.db.query("UPDATE jobs SET lease_until=now()-interval '1 minute',sent_at=CASE WHEN id=$1 THEN now() ELSE NULL END WHERE id=ANY($2::uuid[])", [old.id, [old.id, local.id]]);
    await recoverExpiredJobs(h.context);
    expect((await h.db.query('SELECT status FROM jobs WHERE id=$1', [old.id])).rows[0].status).toBe('unknown');
    const retry = await claimJob(h.context);
    expect(retry?.id).toBe(local.id);
    expect(retry?.lease_token).not.toBe(unsent?.lease_token);
    let calls = 0;
    await runJob(h.context, unsent!, { text: async () => { calls++; return output(); } });
    expect(calls).toBe(0);
    expect(sent?.id).toBe(old.id);
  });
});
