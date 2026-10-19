import { test, expect, type Page } from './fixtures';
import path from 'node:path';

async function prepare(page: Page, skillName: string) {
  // Keep the real login, media upload, and draft persistence. Only generation is delayed.
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    const config = await response.json();
    const text = { ...config.text, enabled: true, configured: true, vision: true };
    await route.fulfill({ response, json: { ...config, singleUserMode: true, text,
      providerPools: { ...config.providerPools, text: [text] } } });
  });
  await page.route('**/api/task-board', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
  const { csrf } = await (await page.request.get('/api/me')).json();
  const response = await page.request.post('/api/skills', {
    data: { name: skillName, kind: 'full', duration: 12, text: '# 提交保护测试\n保持商品外观。', visibility: 'private' },
    headers: { 'X-CSRF-Token': csrf, origin: new URL(page.url()).origin },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByLabel('上传商品图', { exact: true }).setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  const next = page.getByRole('button', { name: '下一步', exact: true });
  await expect(next).toBeDisabled();
  await expect(page.getByText('请选择一个或多个脚本', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `选择脚本：${skillName}`, exact: true }).click();
  await expect(next).toBeEnabled();
  await next.click();
  return page.getByRole('dialog', { name: '生成设置' });
}

test('提交中按 Escape 保持设置弹窗，失败后仍能返回修改', async ({ page }) => {
  const settings = await prepare(page, 'Escape 提交保护十二秒');
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await delayed;
    await route.fulfill({ status: 503, json: { error: '测试：创建请求未完成' } });
  });
  const submitted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/tasks');
  await settings.getByRole('button', { name: '生成提示词', exact: true }).click();
  await submitted;
  try {
    await page.keyboard.press('Escape');
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('button', { name: '提交中…', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(settings.getByRole('alert')).toContainText('测试：创建请求未完成');
  await settings.getByRole('button', { name: '返回', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByLabel('图片 1 用途')).toHaveValue('product');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(settings).toBeVisible();
  // No task was created, and the original product and Skill remain editable.
  await expect(settings.getByText('Escape 提交保护十二秒', { exact: true })).toBeVisible();
});

test('旧提交结束时不清空后来新建任务中的商品和 Skill', async ({ page }) => {
  const skillName = '隔离旧提交十二秒';
  const settings = await prepare(page, skillName);
  const taskId = '66666666-6666-4666-8666-666666666666';
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await route.fulfill({ json: { id: taskId } });
  });
  await page.route(`**/api/tasks/${taskId}/generate`, async route => {
    await delayed;
    await route.fulfill({ json: { id: '77777777-7777-4777-8777-777777777777' } });
  });
  const submitted = page.waitForRequest(request => request.url().endsWith(`/api/tasks/${taskId}/generate`));
  await settings.getByRole('button', { name: '生成提示词', exact: true }).click();
  await submitted;
  try {
    // Fault injection: invoke the existing new-task control while a submission is
    // in flight, covering host/navigation actions even though native modal input
    // normally prevents a pointer click outside the dialog.
    await page.getByRole('button', { name: '新建任务', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(settings).toHaveCount(0);
    await page.getByLabel('上传商品图', { exact: true }).setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
    await page.getByRole('button', { name: `选择脚本：${skillName}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `选择脚本：${skillName}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const completed = page.waitForResponse(response => response.url().endsWith(`/api/tasks/${taskId}/generate`));
    release(); await completed;
    // Browser assertions wait through React's processing of the old response.
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '草稿已保存' })).toBeVisible();
    await expect(page.getByLabel('图片 1 用途')).toHaveValue('product');
    await expect(page.getByRole('button', { name: `选择脚本：${skillName}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(settings.getByText(skillName, { exact: true })).toBeVisible();
  } finally { release(); }
});
