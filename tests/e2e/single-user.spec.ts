import { test, expect, type Page } from './fixtures';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

test.describe('单人直用模式', () => {
  test.skip(process.env.VSW_SINGLE_USER_E2E !== '1', '仅在显式启用的单人隔离测试服务器运行');

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
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result;
    }, { url, body, method });
  }

  test('只配置API即可直接生成，设置页无需请求账号额度', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let accountRequests = 0;
    await page.route(/\/api\/admin\/(?:users|quotas)(?:\?|$)/, async route => {
      accountRequests++;
      await route.fulfill({ status: 503, json: { error: '账号额度服务在此测试中不可用' } });
    });
    await login(page);
    await fixtureRequest(page, '/api/admin/providers/text', { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'single-user-fixture', apiKey: 'fixture-not-live', vision: false, timeoutSeconds: 0 }, 'PUT');
    await fixtureRequest(page, '/api/skills', { name: '单人直用十二秒脚本', kind: 'full', duration: 12, text: '# 十二秒脚本\n保持商品外观，展示商品细节。此内容只用于自动化测试。', tags: ['测试'], visibility: 'private' });
    await page.reload();
    await page.getByLabel('上传商品图').setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
    await page.getByRole('button', { name: '选择脚本：单人直用十二秒脚本', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '生成设置' });
    await expect(settings.getByRole('heading', { name: '常规设置', exact: true })).toBeVisible();
    await expect(settings.getByText(/费用|额度/)).toHaveCount(0);
    const generate = settings.getByRole('button', { name: '生成提示词', exact: true });
    await expect(generate).toBeEnabled();
    const savedTask = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/tasks');
    await generate.click();
    const taskId = (await (await savedTask).json()).id as string;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const taskCard = page.getByRole('complementary', { name: '任务栏' }).getByRole('article', { name: '单人直用十二秒脚本 · 新创作', exact: true }).first();
    await expect(taskCard.getByText('已完成', { exact: true })).toBeVisible({ timeout: 15000 });
    await taskCard.getByRole('button', { name: /^查看详情：/ }).click();
    await expect(page).toHaveURL(new RegExp(`#task/${taskId}$`));
    await expect(page.getByLabel('完整提示词', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('完整提示词', { exact: true })).toHaveValue(/自动化测试结果/);
    await page.route(`**/api/tasks/${taskId}`, async route => {
      const response = await route.fetch();
      const task = await response.json();
      task.jobs.unshift({ id: '33333333-3333-4333-8333-333333333333', kind: 'text', status: 'unknown', attempts: 9, payload: {}, error: '测试：此请求已被后续成功结果替代' });
      await route.fulfill({ response, json: task });
    });
    await page.reload();
    await expect(page.getByLabel('完整提示词', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试这一步', exact: true })).toHaveCount(0);
    await expect(page.getByText(/可用文字额度/)).toHaveCount(0);
    await page.getByRole('link', { name: '管理设置', exact: true }).click();
    const provider = page.locator('section').filter({ has: page.getByRole('heading', { name: '文字／视觉接口', exact: true }) });
    await expect(provider.getByLabel('接口地址', { exact: true })).toBeEditable();
    await expect(page.getByRole('heading', { name: '账号与使用额度' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /创建.*邀请码/ })).toHaveCount(0);
    await provider.getByText('接口高级选项', { exact: true }).click();
    await expect(provider.getByLabel('超时时间（秒）')).toHaveValue('0');
    expect(accountRequests).toBe(0);
    expect(errors).toEqual([]);
    const screenshots = path.join(process.env.VSW_ARTIFACTS_ROOT!, 'e2e', 'single-user');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'single-user-settings.png'), fullPage: true });
  });

  test('响应未知且已重试99次时仍能直接一键重试', async ({ page }) => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const jobId = '22222222-2222-4222-8222-222222222222';
    await page.route(`**/api/tasks/${taskId}`, route => route.fulfill({ json: {
      id: taskId, name: '响应中断的旧任务', status: 'unknown', createdAt: new Date().toISOString(),
      snapshot: { input: { selections: [] }, skills: [] }, results: [], assets: [],
      jobs: [
        { id: jobId, kind: 'text', status: 'unknown', attempts: 99, payload: {}, error: '测试：响应中断' },
        { id: 'old-scene', kind: 'image', status: 'unknown', attempts: 99, payload: { resultId: 'same-result', kind: 'scene', name: '旧场景请求' }, error: '旧场景已被后续成功结果替代' },
        { id: 'new-scene', kind: 'image', status: 'succeeded', attempts: 1, payload: { resultId: 'same-result', kind: 'scene', name: '新场景请求' }, error: null },
      ],
    } }));
    let retries = 0;
    await page.route(`**/api/jobs/${jobId}/retry`, async route => {
      expect(route.request().method()).toBe('POST');
      retries++;
      await route.fulfill({ json: { ok: true } });
    });
    await login(page);
    await page.goto(`/#task/${taskId}`);
    const retry = page.getByRole('button', { name: '重试这一步', exact: true });
    await expect(retry).toBeEnabled();
    await expect(page.getByText('旧场景已被后续成功结果替代')).toHaveCount(0);
    await retry.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: '已重试所选步骤' })).toBeVisible();
    expect(retries).toBe(1);
    await expect(retry).toBeEnabled();
    await expect(page.getByText(/我确认重试并承担/)).toHaveCount(0);
    await expect(page.getByText(/请先核对服务商记录/)).toHaveCount(0);
  });
});
