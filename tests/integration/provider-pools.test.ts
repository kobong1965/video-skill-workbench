import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { harness } from '../helpers';
import { decryptSecret, getProviderPool, eligibleProviders } from '../../packages/providers/config';
import sharp from 'sharp';
import { saveMedia } from '../../packages/storage/private-files';
import { claimJob } from '../../apps/worker/queue';

let h: Awaited<ReturnType<typeof harness>>;
let account: Awaited<ReturnType<typeof h.account>>;
const legacy = { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'fixture', apiKey: 'fixture-secret', vision: true };
beforeAll(async () => { h = await harness('provider_pools'); account = await h.account('admin'); });
afterAll(async () => h.close());

it('旧接口自动成为稳定的池节点，公开响应不含任何密钥', async () => {
  expect((await h.app.inject({ method: 'PUT', url: '/api/admin/providers/text', headers: account.headers, payload: legacy })).statusCode).toBe(200);
  const response = await h.app.inject({ url: '/api/config', headers: account.headers });
  const config = response.json();
  expect(config.providerPools.text[0]).toMatchObject({ id: 'legacy-text', model: 'fixture', hasKey: true, maxConcurrency: 4, activeJobs: 0 });
  expect(config.execution).toEqual({ maxConcurrentJobs: 8 });
  expect(response.body).not.toContain('fixture-secret'); expect(response.body).not.toContain('sealedKey');
});

it('多个模型保留各自密钥，停用首项仍有可用聚合，留空密码不覆盖', async () => {
  const second = { ...legacy, id: randomUUID(), name: '第二接口', model: 'another-model', maxConcurrency: 2, apiKey: 'second-secret' };
  const first = { ...legacy, id: 'legacy-text', name: '原接口', enabled: false, maxConcurrency: 1, apiKey: '' };
  const save = (providers: unknown[]) => h.app.inject({ method: 'PUT', url: '/api/admin/provider-pools/text', headers: account.headers, payload: { providers } });
  expect((await save([first, second])).statusCode).toBe(200);
  const safe = (await h.app.inject({ url: '/api/config', headers: account.headers })).json();
  expect(safe.text).toMatchObject({ id: second.id, enabled: true, configured: true, model: 'another-model' });
  expect(JSON.stringify(safe)).not.toContain('second-secret'); expect(JSON.stringify(safe)).not.toContain('sealedKey');
  expect((await save([first, { ...second, apiKey: '', name: '修改名称' }])).statusCode).toBe(200);
  const stored = await getProviderPool(h.context, 'text');
  expect(decryptSecret(stored[0].sealedKey, h.context.masterKey)).toBe('fixture-secret');
  expect(decryptSecret(stored[1].sealedKey, h.context.masterKey)).toBe('second-secret');
  expect((await save([first, { ...second, id: randomUUID(), apiKey: '' }])).statusCode).toBe(400);
});

it('限制重复ID和非法容量，成员不能管理，显式空池不会回退旧接口', async () => {
  const profile = { ...legacy, id: randomUUID(), name: '接口', maxConcurrency: 1 };
  const save = (providers: unknown[], headers = account.headers) => h.app.inject({ method: 'PUT', url: '/api/admin/provider-pools/text', headers, payload: { providers } });
  expect((await save([profile, profile])).statusCode).toBe(400);
  expect((await save([{ ...profile, maxConcurrency: 0 }])).statusCode).toBe(400);
  const member = await h.account(); expect((await save([profile], member.headers)).statusCode).toBe(403);
  expect((await h.app.inject({ method: 'PUT', url: '/api/admin/execution', headers: account.headers, payload: { maxConcurrentJobs: 33 } })).statusCode).toBe(400);
  expect((await h.app.inject({ method: 'PUT', url: '/api/admin/execution', headers: account.headers, payload: { maxConcurrentJobs: 12 } })).statusCode).toBe(200);
  expect((await save([])).statusCode).toBe(200);
  expect(await getProviderPool(h.context, 'text')).toEqual([]);
  expect((await h.app.inject({ url: '/api/config', headers: account.headers })).json()).toMatchObject({ text: { enabled: false, configured: false }, execution: { maxConcurrentJobs: 12 } });
});

it('按请求参考图能力筛选，单人模式延续原有兼容行为', () => {
  const base = { ...legacy, protocol: 'openai-compatible' as const, sealedKey: 'sealed', references: false, multiReference: false, timeoutSeconds: 0, outputHosts: [], jsonMode: true };
  const configs = [{ ...base, id: 'plain' }, { ...base, id: 'multi', references: true, multiReference: true }];
  expect(eligibleProviders(configs, 'image', false, { referenceMediaIds: ['one', 'two'] }).map(x => x.id)).toEqual(['multi']);
  expect(eligibleProviders(configs, 'image', true, { referenceMediaIds: ['one', 'two'] })).toHaveLength(2);
});

it('新提交自动路由且幂等，领取后任务API只公开实际接口标识', async () => {
  const id = randomUUID();
  await h.app.inject({ method: 'PUT', url: '/api/admin/provider-pools/text', headers: account.headers, payload: { providers: [{ ...legacy, id, name: '自动节点', maxConcurrency: 1 }] } });
  await h.db.query("INSERT INTO quotas(user_id,kind,allowance) VALUES($1,'text',10)", [account.id]);
  const media = await saveMedia(h.context, account.id, 'test.png', await sharp({ create: { width: 16, height: 16, channels: 3, background: '#aaa' } }).png().toBuffer());
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: account.headers, payload: { name: '池分配测试', text: '自然展示', kind: 'opening', duration: 3 } })).json();
  const task = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: account.headers, payload: { name: '自动分配', media: [{ id: media.id, role: 'product' }], platform: 'tiktok', market: 'US', category: '服装', targetDuration: 3, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 3 }] } })).json();
  const key = randomUUID();
  const submit = () => h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/generate`, headers: account.headers, payload: { key, costAccepted: true } });
  const [a, b] = await Promise.all([submit(), submit()]);
  expect(a.statusCode).toBe(200); expect(b.json().id).toBe(a.json().id);
  const queued = (await h.app.inject({ url: `/api/tasks/${task.id}`, headers: account.headers })).json();
  expect(queued.jobs[0].provider).toBeNull();
  const job = await claimJob(h.context); expect(job?.provider.id).toBe(id); expect(job?.provider.routing).toBeUndefined();
  for (const url of [`/api/tasks/${task.id}`, '/api/task-board']) {
    const response = await h.app.inject({ url, headers: account.headers });
    expect(response.body).not.toContain('fixture-secret'); expect(response.body).not.toContain('sealedKey'); expect(response.body).not.toContain('frozenProvider');
    const data = response.json();
    expect((Array.isArray(data) ? data.find(x => x.id === task.id).latestJob : data.jobs[0]).provider).toEqual({ id, name: '自动节点', model: 'fixture' });
  }
  const config = (await h.app.inject({ url: '/api/config', headers: account.headers })).json();
  expect(config.providerPools.text[0].activeJobs).toBe(1);
});
