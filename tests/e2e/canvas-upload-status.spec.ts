import { test, expect, type Page } from './fixtures';
import type { TaskCanvasUploadSummary, TaskSummary } from '../../packages/contracts';

const now = '2026-10-19T12:00:00.000Z';
function summary(index: number, status?: TaskCanvasUploadSummary['status'], previouslyUploaded = false): TaskSummary {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, name: `画布状态任务${index}`,
    status: 'awaiting_confirmation', createdAt: now, updatedAt: now, parentId: null,
    thumbnailMediaId: null, latestResultId: '22222222-2222-4222-8222-222222222222', activeJobs: 0,
    latestJob: null, skillPreviews: [], progress: { stage: 'ready', label: '提示词已生成', value: 100 },
    ...(status ? { canvasUpload: { status, previouslyUploaded, resultId: '22222222-2222-4222-8222-222222222222', importId: null, projectId: null, projectUrl: null, updatedAt: now } } : {}),
  };
}

async function prepare(page: Page, current: () => TaskSummary[]) {
  const requests: string[] = []; const errors: string[] = []; const mutations: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    requests.push(pathname);
    if (request.method() !== 'GET' && /\/(generate|images|retry|canvas-imports)(\/|$)/.test(pathname)) mutations.push(pathname);
  });
  await page.route('**/api/task-board', route => route.fulfill({ json: current() }));
  await page.route('**/api/tasks', route => route.fulfill({ json: current() }));
  await page.route('**/api/drafts', route => route.fulfill({ json: [] }));
  await page.route('**/api/skills', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('complementary', { name: '任务栏' })).toBeVisible();
  return { requests, errors, mutations };
}

test('任务栏和记录同时展示真实画布状态，旧摘要保守回退且窄窗口可读', async ({ page }, info) => {
  const tasks = [summary(1, 'uploaded'), summary(2, 'not_uploaded', true), summary(3, 'uploading'), summary(4, 'failed'), summary(5, 'unknown'), summary(6)];
  const tracked = await prepare(page, () => tasks);
  const board = page.getByRole('complementary', { name: '任务栏' });
  const labels = ['已上传画布', '未上传画布', '上传画布中', '画布上传失败', '画布待确认', '画布待确认'];
  for (const [index, label] of labels.entries()) {
    const card = board.getByRole('article', { name: tasks[index].name, exact: true });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText('已完成', { exact: true })).toBeVisible();
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(board.getByRole('article', { name: tasks[1].name, exact: true }).getByText('未上传画布', { exact: true })).toHaveAttribute('title', /旧版本曾上传/);
  await board.getByRole('article', { name: tasks[0].name, exact: true }).scrollIntoViewIfNeeded();
  await board.screenshot({ path: info.outputPath('canvas-status-task-board.png') });
  await page.getByRole('link', { name: '生成记录', exact: true }).click();
  for (const [index, label] of labels.entries()) {
    const row = page.getByRole('article', { name: tasks[index].name, exact: true });
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByText(label, { exact: true })).toBeVisible();
  }
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`canvas-status-history-${width}.png`), fullPage: true });
  }
  expect(tracked.requests.filter(url => /\/canvas-imports/.test(url))).toEqual([]);
  expect(tracked.mutations).toEqual([]); expect(tracked.errors).toEqual([]);
});

test('上传中到成功无需刷新页面，记录页和任务栏都自动更新', async ({ page }) => {
  let tasks = [summary(1, 'not_uploaded')];
  const tracked = await prepare(page, () => tasks);
  const card = page.getByRole('article', { name: tasks[0].name, exact: true });
  await expect(card.getByText('未上传画布', { exact: true })).toBeVisible();
  tasks = [summary(1, 'uploading')];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('workbench:tasks-changed')));
  await expect(card.getByText('上传画布中', { exact: true })).toBeVisible();
  tasks = [summary(1, 'uploaded')];
  await expect(card.getByText('已上传画布', { exact: true })).toBeVisible({ timeout: 8000 });
  await page.getByRole('link', { name: '生成记录', exact: true }).click();
  await expect(card.getByText('已上传画布', { exact: true })).toBeVisible();
  tasks = [summary(1, 'unknown')];
  await expect(card.getByText('画布待确认', { exact: true })).toBeVisible({ timeout: 8000 });
  expect(tracked.requests.filter(url => /\/canvas-imports/.test(url))).toEqual([]);
  expect(tracked.mutations).toEqual([]); expect(tracked.errors).toEqual([]);
});
