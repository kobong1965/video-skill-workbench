import { test, expect } from './fixtures';
import path from 'node:path';

test('任务栏持续展示后台任务，等待上游时不伪造百分比', async ({ page }, info) => {
  const tasks = [
    { id: '11111111-1111-4111-8111-111111111111', name: '第一件商品', status: 'processing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), thumbnailMediaId: 'product-one', latestResultId: null, activeJobs: 1, latestJob: null, progress: { stage: 'waiting', label: '正在分析商品与脚本', value: null } },
    { id: '22222222-2222-4222-8222-222222222222', name: '第二件商品', status: 'awaiting_confirmation', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), thumbnailMediaId: null, latestResultId: '33333333-3333-4333-8333-333333333333', activeJobs: 0, latestJob: null, progress: { stage: 'ready', label: '提示词已完成', value: 100 } },
    { id: '44444444-4444-4444-8444-444444444444', name: '中断的商品', status: 'unknown', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), thumbnailMediaId: 'product-one', latestResultId: null, activeJobs: 0, latestJob: { id: '55555555-5555-4555-8555-555555555555', status: 'unknown', error: '上游响应中断，服务端可能已执行，请核对后决定是否重试' }, progress: { stage: 'unknown', label: '连接中断', value: null } },
  ];
  await page.route('**/api/media/product-one', route => route.fulfill({ path: path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'), contentType: 'image/png' }));
  await page.route('**/api/task-board', route => route.fulfill({ json: tasks }));
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  const board = page.getByRole('complementary', { name: '任务栏' });
  const working = board.getByRole('article', { name: '第一件商品' });
  await expect(working.locator('img')).toBeVisible();
  await expect(working.getByRole('button', { name: '查看任务：第一件商品', exact: true })).toBeVisible();
  await expect(working.getByRole('button', { name: '查看详情：第一件商品', exact: true })).toBeVisible();
  await expect(board.getByText('第一件商品', { exact: true })).toHaveCount(0);
  await expect(working.locator('time')).toHaveCount(0);
  await expect(working.getByText('任务已保存', { exact: true })).toHaveCount(0);
  await expect(working.getByText('正在分析商品与脚本', { exact: true })).toHaveCount(0);
  await expect(working.getByText('正在生成', { exact: true })).toBeVisible();
  await expect(working.getByRole('progressbar')).toHaveCount(0);
  await expect(board.getByRole('article', { name: '第二件商品' }).getByText('已完成', { exact: true })).toBeVisible();
  const interrupted = board.getByRole('article', { name: '中断的商品' });
  await expect(interrupted.getByText('连接中断', { exact: true })).toBeVisible();
  await expect(interrupted.getByRole('progressbar')).toHaveCount(0);
  for (const card of [working, interrupted]) {
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeLessThanOrEqual(140);
  }
  await board.screenshot({ path: info.outputPath('compact-task-board.png') });
  await expect(page.getByText('YOUR CREATIVE WORKSPACE')).toHaveCount(0);
  await expect(page.getByText('从一个好脚本开始')).toHaveCount(0);
  await board.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(working.getByRole('button', { name: '查看详情：第一件商品', exact: true })).toBeVisible();
  await expect(page.getByLabel('上传商品图')).toBeAttached();
});
