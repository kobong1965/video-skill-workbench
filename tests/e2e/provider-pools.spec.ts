import { test, expect, type Page } from './fixtures';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
}

test('管理多个接口时留空保留原密钥、移除按 ID 生效，并行上限可保存', async ({ page }) => {
  const original = { id: 'legacy-text', name: '主视觉', enabled: true, configured: true, hasKey: true,
    protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'fixture-vision-a',
    vision: true, references: false, multiReference: false, timeoutSeconds: 0, jsonMode: true, outputHosts: [], maxConcurrency: 4, activeJobs: 1 };
  let pool: Record<string, unknown>[] = [original];
  let limit = 8;
  const saves: { providers: Record<string, unknown>[] }[] = [];
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, singleUserMode: true,
      text: pool.find(item => item.enabled && item.configured) ?? { enabled: false, configured: false, hasKey: false },
      providerPools: { text: pool, image: [] }, execution: { maxConcurrentJobs: limit } } });
  });
  await page.route('**/api/admin/provider-pools/text', async route => {
    expect(route.request().method()).toBe('PUT');
    const body = route.request().postDataJSON() as { providers: Record<string, unknown>[] };
    saves.push(body);
    pool = body.providers.map(({ apiKey, ...item }) => ({ ...item, configured: true, hasKey: Boolean(apiKey || pool.find(prior => prior.id === item.id)?.hasKey), activeJobs: 0 }));
    await route.fulfill({ json: { providers: pool } });
  });
  await page.route('**/api/admin/execution', async route => {
    limit = route.request().postDataJSON().maxConcurrentJobs;
    await route.fulfill({ json: { maxConcurrentJobs: limit } });
  });
  await login(page);
  await page.getByRole('link', { name: '管理设置', exact: true }).click();
  const first = page.getByRole('region', { name: '文字／视觉接口配置 1', exact: true });
  await expect(first.getByLabel('接口密钥', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '添加文字接口', exact: true }).click();
  const second = page.getByRole('region', { name: '文字／视觉接口配置 2', exact: true });
  await second.getByLabel('接口名称', { exact: true }).fill('备用视觉');
  await second.getByLabel('接口地址', { exact: true }).fill('https://api.example.net/v1');
  await second.getByLabel('模型名称', { exact: true }).fill('fixture-vision-b');
  await second.getByLabel('接口密钥', { exact: true }).fill('fixture-only-new-key');
  await second.getByLabel('每个接口同时处理上限', { exact: true }).fill('2');
  await second.getByRole('button', { name: '保存文字／视觉接口', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '文字接口池已保存' })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0]!.providers[0]).not.toHaveProperty('apiKey');
  expect(saves[0]!.providers[1]).toMatchObject({ name: '备用视觉', model: 'fixture-vision-b', apiKey: 'fixture-only-new-key', maxConcurrency: 2 });
  const secondId = String(saves[0]!.providers[1]!.id);
  expect(secondId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(second.getByLabel('接口密钥', { exact: true })).toHaveValue('');
  await expect(page.locator('body')).not.toContainText('fixture-only-new-key');
  await first.getByRole('button', { name: '移除接口：主视觉', exact: true }).click();
  await page.getByRole('button', { name: '保存文字接口池', exact: true }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1]!.providers).toHaveLength(1);
  expect(saves[1]!.providers[0]).toMatchObject({ id: secondId, name: '备用视觉' });
  expect(saves[1]!.providers[0]).not.toHaveProperty('apiKey');
  await page.getByLabel('同时处理上限', { exact: true }).fill('6');
  await page.getByRole('button', { name: '保存并行设置', exact: true }).click();
  await expect.poll(() => limit).toBe(6);
  await page.reload();
  await expect(page.getByLabel('同时处理上限', { exact: true })).toHaveValue('6');
  await expect(page.getByRole('region', { name: '文字／视觉接口配置 1', exact: true }).getByLabel('接口密钥', { exact: true })).toHaveValue('');
});

test('任务栏同时显示运行和排队计划及各自实际分配，等待任务不冒充分配', async ({ page }) => {
  const base = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), parentId: null,
    thumbnailMediaId: null, latestResultId: null, activeJobs: 1, skillPreviews: [] };
  const tasks = [
    { ...base, id: '11111111-1111-4111-8111-111111111111', name: '计划甲', status: 'processing', progress: { stage: 'waiting', label: '生成提示词中', value: null },
      latestJob: { id: 'job-a', kind: 'text', status: 'running', provider: { id: 'p-a', name: '主视觉', model: 'fixture-vision-a' } } },
    { ...base, id: '22222222-2222-4222-8222-222222222222', name: '计划乙', status: 'processing', progress: { stage: 'waiting', label: '生成提示词中', value: null },
      latestJob: { id: 'job-b', kind: 'text', status: 'running', provider: { id: 'p-b', name: '备用视觉', model: 'fixture-vision-b' } } },
    { ...base, id: '33333333-3333-4333-8333-333333333333', name: '计划丙', status: 'queued', progress: { stage: 'queued', label: '排队中', value: 0 },
      latestJob: { id: 'job-c', kind: 'text', status: 'queued', provider: null } },
  ];
  await page.route('**/api/task-board', route => route.fulfill({ json: tasks }));
  await login(page);
  const board = page.getByRole('complementary', { name: '任务栏', exact: true });
  await expect(board.getByText('2 个生成中', { exact: true })).toBeVisible();
  await expect(board.getByText('1 个排队中', { exact: true })).toBeVisible();
  await expect(board.getByRole('article', { name: '计划甲', exact: true }).getByLabel('分配接口：主视觉 · fixture-vision-a', { exact: true })).toBeVisible();
  await expect(board.getByRole('article', { name: '计划乙', exact: true }).getByLabel('分配接口：备用视觉 · fixture-vision-b', { exact: true })).toBeVisible();
  const queued = board.getByRole('article', { name: '计划丙', exact: true });
  await expect(queued.locator('.task-provider')).toHaveCount(0);
  await expect(board.getByRole('progressbar')).toHaveCount(0);
  for (const card of await board.getByRole('article').all()) expect((await card.boundingBox())!.height).toBeLessThanOrEqual(140);
});
