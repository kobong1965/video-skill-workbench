import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { setTimeout as waitForRateWindow } from 'node:timers/promises';

test.beforeEach(async ({ request }, info) => {
  // Browser suites share an isolated server/IP. Respect the real limiter when
  // previous fast fixtures have consumed its budget; never disable protection.
  const response = await request.get('/api/health');
  const remaining = Number(response.headers()['x-ratelimit-remaining']);
  if (remaining < 250) {
    const reset = Number(response.headers()['x-ratelimit-reset']);
    expect(Number.isFinite(reset) && reset >= 0 && reset <= 60).toBe(true);
    info.setTimeout(125000);
    await waitForRateWindow((reset + 1) * 1000);
  }
});

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台' })).toBeVisible();
}
async function fixtureRequest(page: Page, url: string, body: unknown, method = 'POST') {
  return page.evaluate(async ({ url, body, method }) => {
    const { csrf } = await (await fetch('/api/me')).json();
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); return result;
  }, { url, body, method });
}
async function screenshot(page: Page, name: string) {
  const root = 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/e2e/screenshots';
  await mkdir(root, { recursive: true });
  await page.screenshot({ path: path.join(root, `${name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('登录后可以从上传商品开始，不被高级设置阻挡', async ({ page }) => {
  await login(page);
  await expect(page.getByText('自动化测试环境')).toBeVisible();
  await page.getByLabel('上传商品图').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await expect(page.getByAltText('sample-product.png')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成提示词', exact: true })).toBeDisabled();
});

test('额度未加载时不显示可编辑默认零值，加载后保存实际输入', async ({ page }) => {
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  await page.route('**/api/admin/quotas', async route => { if (first) { first = false; await gate; } await route.continue(); });
  try {
    await page.getByRole('link', { name: '管理设置' }).click();
    await expect(page.getByText('正在读取账号额度…', { exact: true })).toBeVisible();
    await expect(page.getByLabel('e2e-admin文字总额度')).toHaveCount(0);
    release();
    await page.getByLabel('e2e-admin文字总额度').fill('23');
    await page.getByLabel('e2e-admin图片总额度').fill('7');
    const request = page.waitForRequest(r => r.method() === 'PUT' && r.url().includes('/api/admin/quotas/'));
    await page.getByRole('row').filter({ has: page.getByLabel('e2e-admin文字总额度') }).getByRole('button', { name: '保存额度', exact: true }).click();
    expect((await request).postDataJSON()).toEqual({ text: 23, image: 7 });
    await page.reload();
    await expect(page.getByLabel('e2e-admin文字总额度')).toHaveValue('23');
  } finally { release(); }
});

test('导入真实文件形态、配置、生成、编辑、确认、复制和下载完整流程', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.getByRole('link', { name: '脚本库', exact: true }).click();
  await page.getByRole('button', { name: '＋ 导入脚本' }).click();
  await page.getByLabel('导入脚本文件').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-skill.md'));
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '停车场上衣 · 测试样例' })).toBeVisible();
  await screenshot(page, '02-script-library');
  await page.getByRole('button', { name: '查看脚本', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('强自然阳光');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('link', { name: '管理设置' }).click();
  const provider = page.locator('section').filter({ has: page.getByRole('heading', { name: '文字／视觉接口', exact: true }) });
  await provider.getByLabel('启用文字／视觉接口').check();
  await provider.getByLabel('接口地址', { exact: true }).fill('https://api.example.com/v1');
  await provider.getByLabel('模型名称').fill('test-fixture-no-live-api');
  await provider.getByLabel('接口密钥').fill('test-fixture-not-a-real-key');
  await provider.getByLabel('已确认支持商品图片输入').check();
  await provider.getByRole('button', { name: '保存文字／视觉接口' }).click();
  await expect(provider.getByLabel('接口密钥')).toHaveValue('');
  await page.getByLabel('e2e-admin文字总额度').fill('50');
  await page.getByLabel('e2e-admin图片总额度').fill('50');
  await page.getByRole('row').filter({ has: page.getByLabel('e2e-admin文字总额度') }).getByRole('button', { name: '保存额度', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '总额度已更新' })).toBeVisible();
  await page.getByRole('link', { name: '脚本库', exact: true }).click();
  await page.getByRole('button', { name: '使用这个脚本', exact: true }).click();
  await page.getByLabel('上传商品图').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await expect(page.getByRole('button', { name: '生成提示词', exact: true })).toBeEnabled();
  for (const [width, height] of [[1366, 900], [1440, 900], [1920, 1080]]) { await page.setViewportSize({ width, height }); await screenshot(page, `01-workbench-${width}`); }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '生成提示词', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不生成人物图');
  await page.getByRole('button', { name: '确认，开始生成' }).click();
  await expect(page.getByLabel('全片共用要求')).toBeVisible({ timeout: 15000 });
  const taskURL = page.url();
  const taskId = taskURL.split('task/')[1];
  expect(await page.evaluate(async id => (await (await fetch(`/api/tasks/${id}`)).json()).jobs.filter((x: { kind: string }) => x.kind === 'image').length, taskId)).toBe(0);
  await page.getByLabel('镜头 1 提示词').fill('【测试修订】自然阳光照射当前商品，微风轻拂发丝，人物静默展示。');
  await expect(page.getByRole('button', { name: '确认这版脚本' })).toBeDisabled();
  await page.getByRole('button', { name: '保存修改为新版本' }).click();
  await expect(page.getByLabel('查看保存版本')).toContainText('R2');
  await page.reload();
  await expect(page.getByLabel('镜头 1 提示词')).toHaveValue(/测试修订/);
  await page.getByRole('button', { name: '确认这版脚本' }).click();
  await expect(page.getByRole('button', { name: '打包完整资料' })).toBeEnabled();
  await page.getByRole('button', { name: '复制整段提示词' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('测试修订');
  await page.getByRole('button', { name: '打包完整资料' }).click();
  await expect(page.getByRole('link', { name: /下载完整资料包/ })).toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.getByRole('link', { name: /下载完整资料包/ }).click();
  const download = await downloaded; await download.saveAs('E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/e2e/verified-ui-export.zip');
  await screenshot(page, '03-confirmed-result');
  await page.getByRole('link', { name: '生成记录' }).click();
  await expect(page.getByRole('button', { name: '打开', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '打开', exact: true }).first().click();
  await expect(page).toHaveURL(taskURL);
  expect(errors).toEqual([]);
});

test('只要三秒开头不补全片，组合顺序保持，超长批次需参考图确认', async ({ page }) => {
  await login(page);
  await fixtureRequest(page, '/api/admin/providers/text', { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test-only', apiKey: 'test-only', vision: true }, 'PUT');
  await fixtureRequest(page, '/api/admin/providers/image', { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test-only', apiKey: 'test-only', references: true, multiReference: true }, 'PUT');
  const me = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user);
  await fixtureRequest(page, `/api/admin/quotas/${me.id}`, { text: 50, image: 50 }, 'PUT');
  const skills = [];
  for (const [name, kind, duration] of [['开头三秒测试', 'opening', 3], ['细节七秒测试', 'detail', 7], ['长片测试', 'full', 40]] as const) skills.push(await fixtureRequest(page, '/api/skills', { name, kind, duration, text: `# ${name}\n仅为自动化流程测试的脚本。`, tags: ['测试'], visibility: 'private' }));
  await page.getByLabel('上传商品图').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await expect(page.getByAltText('sample-product.png')).toBeVisible();
  const mediaId = (await page.getByAltText('sample-product.png').getAttribute('src'))!.split('/').at(-1);
  const base = { name: '仅开头验收', media: [{ id: mediaId, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 30, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none' };
  async function run(input: unknown) { const task = await fixtureRequest(page, '/api/tasks', input); await fixtureRequest(page, `/api/tasks/${task.id}/generate`, { key: crypto.randomUUID(), costAccepted: true }); await page.goto(`/#task/${task.id}`); await expect(page.getByLabel('全片共用要求')).toBeVisible({ timeout: 15000 }); return task.id; }
  await run({ ...base, selections: [{ id: skills[0].id, versionId: skills[0].versionId, duration: 3 }] });
  await expect(page.getByText('共 1 个镜头 · 所选内容 3 秒')).toBeVisible();
  await page.getByText('第 1 批 · 创意内容 3 秒', { exact: false }).click();
  await expect(page.getByText('平台若要求至少 4 秒', { exact: false })).toBeVisible();
  await screenshot(page, '04-hook-only');
  await run({ ...base, name: '组合验收', selections: skills.slice(0, 2).map((x, i) => ({ id: x.id, versionId: x.versionId, duration: i ? 7 : 3 })) });
  await expect(page.getByText('共 2 个镜头 · 所选内容 10 秒')).toBeVisible();
  await screenshot(page, '05-composed');
  const longId = await run({ ...base, name: '跨批次验收', targetDuration: 40, generatePerson: true, model: 'seedance-2.0', selections: [{ id: skills[2].id, versionId: skills[2].versionId, duration: 40 }] });
  await page.getByRole('button', { name: '确认这版脚本' }).click();
  await expect(page.getByRole('button', { name: '打包完整资料' })).toBeDisabled();
  const masterSlot = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: '人物主参考', exact: true }) });
  await masterSlot.getByRole('button', { name: '生成一张', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认生成一张' })).toBeDisabled();
  await page.getByLabel('我确认本次图片生成及可能产生的费用').check();
  await page.getByRole('button', { name: '确认生成一张' }).click();
  await expect(page.getByRole('button', { name: '确认使用这张图' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /基于已确认主图/ })).toHaveCount(0);
  await page.getByRole('button', { name: '确认使用这张图' }).click();
  await expect(page.getByRole('button', { name: /基于已确认主图/ })).toBeEnabled();
  for (let batch = 1; batch <= 3; batch++) {
    const slot = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: `第 ${batch} 批故事面板`, exact: true }) });
    await slot.getByRole('button', { name: '生成一张', exact: true }).click(); await page.getByLabel('我确认本次图片生成及可能产生的费用').check(); await page.getByRole('button', { name: '确认生成一张' }).click();
    await expect(page.getByRole('button', { name: '确认使用这张图' })).toBeVisible({ timeout: 15000 }); await page.getByRole('button', { name: '确认使用这张图' }).click();
  }
  await expect(page.getByRole('button', { name: '打包完整资料' })).toBeEnabled();
  await screenshot(page, '06-batch-assets');
  await page.getByText('第 2 批 · 创意内容', { exact: false }).click();
  await page.getByRole('button', { name: '补充上一批真实尾帧', exact: true }).click();
  await page.getByLabel('真实尾帧图片').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await page.getByLabel('这是上一批实际生成视频的尾帧').check();
  await page.getByRole('button', { name: '保存衔接新版本' }).click();
  await expect(page.getByLabel('查看保存版本')).toContainText('R2');
  const detail = await page.evaluate(async id => (await (await fetch(`/api/tasks/${id}`)).json()), longId);
  expect(detail.results[0].output.shots[1].prompt).toContain('真实尾帧');
  expect(detail.results[1].output.shots[1].prompt).not.toContain('真实尾帧');
});
