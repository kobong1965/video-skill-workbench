import { test, expect, type Page } from './fixtures';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

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
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await expect(page.getByText('请选择一个或多个脚本', { exact: true })).toBeVisible();
  const actions = page.getByRole('region', { name: '创作操作', exact: true });
  await expect(actions.getByRole('button', { name: '保存草稿', exact: true })).toBeVisible();
  expect((await actions.boundingBox())!.y).toBeLessThan((await page.locator('.creation-product').boundingBox())!.y);
  await expect(page.getByRole('dialog', { name: '生成设置' })).toHaveCount(0);
  const skill = await fixtureRequest(page, '/api/skills', { name: '选择后才能下一步验证脚本', kind: 'opening', duration: 3, text: '# 开头\n只用于本地页面验证，不生成。', visibility: 'private' });
  await page.reload();
  await page.getByLabel('上传商品图').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await expect(page.getByAltText('sample-product.png')).toBeVisible();
  await page.getByRole('button', { name: `选择脚本：${skill.name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  await expect(page.getByText('请选择一个或多个脚本', { exact: true })).toHaveCount(0);
  const viewport = page.getByRole('region', { name: '全部 Skill', exact: true });
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(actions.getByRole('button', { name: '下一步', exact: true })).toBeInViewport();
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

test('导入真实文件形态、配置、生成、统一编辑、复制与画布入口完整流程', async ({ page, context }) => {
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
  const parkingCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '停车场上衣 · 测试样例', exact: true }) });
  await parkingCard.getByRole('button', { name: '查看脚本', exact: true }).click();
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
  await parkingCard.getByRole('button', { name: '使用这个脚本', exact: true }).click();
  await page.getByLabel('上传商品图').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  for (const [width, height] of [[1366, 900], [1440, 900], [1920, 1080]]) { await page.setViewportSize({ width, height }); await screenshot(page, `01-workbench-${width}`); }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '生成设置' });
  await expect(settings.getByRole('heading', { name: '常规设置', exact: true })).toBeVisible();
  await expect(settings.getByLabel('人物参考图', { exact: true })).not.toBeChecked();
  await expect(settings.getByLabel('场景参考图', { exact: true })).not.toBeChecked();
  const savedTask = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/tasks');
  await settings.getByRole('button', { name: '生成提示词', exact: true }).click();
  const taskId = (await (await savedTask).json()).id as string;
  await expect(settings).toHaveCount(0);
  const taskCard = page.getByRole('complementary', { name: '任务栏' }).getByRole('article', { name: '停车场上衣 · 测试样例 · 新创作', exact: true }).first();
  await expect(taskCard.getByText('已完成', { exact: true })).toBeVisible({ timeout: 15000 });
  await taskCard.getByRole('button', { name: /^查看详情/ }).click();
  await expect(page).toHaveURL(new RegExp(`#task/${taskId}$`));
  const editor = page.getByRole('textbox', { name: '完整提示词', exact: true });
  await expect(editor).toBeVisible({ timeout: 15000 });
  const taskURL = page.url();
  expect(await page.evaluate(async id => (await (await fetch(`/api/tasks/${id}`)).json()).jobs.filter((x: { kind: string }) => x.kind === 'image').length, taskId)).toBe(0);
  await expect(page.getByRole('region', { name: '提示词编辑', exact: true }).getByRole('textbox')).toHaveCount(1);
  await editor.fill((await editor.inputValue()).replace('自然阳光照射商品', '【测试修订】自然阳光照射当前商品'));
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认这版脚本' })).toHaveCount(0);
  await page.getByRole('button', { name: '保存修改为新版本' }).click();
  await expect(page.getByLabel('查看保存版本')).toContainText('R2');
  await page.reload();
  await expect(editor).toHaveValue(/测试修订/);
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: '参考图准备', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '复制与导出', exact: true })).toHaveCount(0);
  await expect(page.getByText('先看脚本，满意再继续', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '复制整段提示词' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('测试修订');
  await screenshot(page, '03-unified-result');
  await page.getByRole('link', { name: '生成记录' }).click();
  await expect(page.getByRole('button', { name: '打开', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '打开', exact: true }).first().click();
  await expect(page).toHaveURL(taskURL);
  expect(errors).toEqual([]);
});

test('统一面板保留三秒开头、组合顺序与跨批次完整内容，不显示被取消的板块', async ({ page }) => {
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
  const editor = page.getByRole('textbox', { name: '完整提示词', exact: true });
  async function run(input: unknown) { const task = await fixtureRequest(page, '/api/tasks', input); await fixtureRequest(page, `/api/tasks/${task.id}/generate`, { key: crypto.randomUUID(), costAccepted: true }); await page.goto(`/#task/${task.id}`); await expect(editor).toBeVisible({ timeout: 15000 }); return (await page.request.get(`/api/tasks/${task.id}`)).json(); }
  const hook = await run({ ...base, selections: [{ id: skills[0].id, versionId: skills[0].versionId, duration: 3 }] });
  expect(hook.results[0].output.shots).toHaveLength(1);
  expect(hook.results[0].output.shots[0].duration).toBe(3);
  await expect(editor).toHaveValue(/自然阳光照射商品/);
  await screenshot(page, '04-hook-only');
  const composed = await run({ ...base, name: '组合验收', selections: skills.slice(0, 2).map((x, i) => ({ id: x.id, versionId: x.versionId, duration: i ? 7 : 3 })) });
  expect(composed.results[0].output.shots.map((shot: { duration: number }) => shot.duration)).toEqual([3, 7]);
  expect(composed.results[0].output.shots.map((shot: { skillVersionId: string }) => shot.skillVersionId)).toEqual(skills.slice(0, 2).map(skill => skill.versionId));
  expect((await editor.inputValue()).match(/自然阳光照射商品/g)).toHaveLength(2);
  await screenshot(page, '05-composed');
  const long = await run({ ...base, name: '跨批次验收', targetDuration: 40, generatePerson: true, model: 'seedance-2.0', selections: [{ id: skills[2].id, versionId: skills[2].versionId, duration: 40 }] });
  expect(long.results[0].output.shots).toHaveLength(3);
  expect((await editor.inputValue()).match(/自然阳光照射商品/g)).toHaveLength(3);
  await expect(page.getByRole('region', { name: '提示词编辑', exact: true }).getByRole('textbox')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '确认这版脚本', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '参考图准备', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '复制与导出', exact: true })).toHaveCount(0);
  expect(long.jobs.filter((job: { kind: string }) => job.kind === 'image')).toHaveLength(0);
  await screenshot(page, '06-unified-multi-batch');
});
