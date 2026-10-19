import { test, expect, type Page } from './fixtures';
import path from 'node:path';

const productId = 'product-cover';
const imageId = 'script-image-cover';
const videoId = 'script-video-cover';
const brokenImageId = 'script-broken-cover';
const brokenVideoId = 'script-broken-video';
const fixedTime = '2026-10-19T03:00:00.000Z';
const preview = (index: number, name: string, imageMediaId: string | null, videoMediaId: string | null = null) => ({
  id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
  versionId: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
  name, imageMediaId, videoMediaId,
});
const imageSkill = preview(1, '车库换装', imageId, videoId);
const movieSkill = preview(2, '深蹲展示', null, videoId);
const emptySkill = preview(3, '无封面脚本', null);
const brokenSkill = preview(4, '图片失效回退视频', brokenImageId, videoId);
const unavailableSkill = preview(5, '失效素材脚本', brokenImageId, brokenVideoId);
function task(index: number, name: string, stage: string, skillPreviews?: ReturnType<typeof preview>[]) {
  return {
    id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`, name,
    status: stage === 'ready' ? 'awaiting_confirmation' : stage === 'waiting' ? 'processing' : stage,
    createdAt: fixedTime, updatedAt: fixedTime, thumbnailMediaId: productId,
    latestResultId: stage === 'ready' ? '44444444-4444-4444-8444-444444444444' : null,
    activeJobs: ['waiting', 'queued'].includes(stage) ? 1 : 0, latestJob: null,
    progress: { stage, label: stage, value: stage === 'ready' ? 100 : null },
    ...(skillPreviews !== undefined ? { skillPreviews } : {}),
  };
}
type Summary = ReturnType<typeof task>;

async function login(page: Page) {
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
}
async function tinyMovie(page: Page) {
  // A local, programmatically recorded test asset; never downloaded or AI-generated.
  return Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 128;
    const drawing = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' });
    const chunks: Blob[] = []; recorder.ondataavailable = event => chunks.push(event.data);
    const finished = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' })); });
    let frame = 0;
    const timer = setInterval(() => { drawing.fillStyle = frame++ % 2 ? '#8d86bf' : '#b5d6c7'; drawing.fillRect(0, 0, 96, 128); }, 100);
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 1500)); recorder.stop();
    const blob = await finished; clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }), 'base64');
}
async function prepare(page: Page, summaries: Summary[], options: { video?: boolean; emptySkills?: boolean } = {}) {
  const requests: string[] = []; const mutations: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    requests.push(pathname);
    if (request.method() !== 'GET' && /\/(generate|images|retry|canvas-imports)(\/|$)/.test(pathname)) mutations.push(`${request.method()} ${pathname}`);
  });
  await page.route('**/api/task-board', route => route.fulfill({ json: summaries }));
  await page.route('**/api/tasks', route => route.request().method() === 'GET' ? route.fulfill({ json: summaries }) : route.continue());
  await page.route('**/api/drafts', route => route.fulfill({ json: [] }));
  if (options.emptySkills) await page.route('**/api/skills', route => route.fulfill({ json: [] }));
  await page.route(`**/api/media/${productId}`, route => route.fulfill({ path: path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'), contentType: 'image/png' }));
  await page.route(`**/api/media/${imageId}`, route => route.fulfill({ path: path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'), contentType: 'image/png' }));
  await page.route(`**/api/media/${brokenImageId}`, route => route.fulfill({ status: 404, body: 'isolated missing image' }));
  await page.route(`**/api/media/${brokenVideoId}`, route => route.fulfill({ status: 404, body: 'isolated missing video' }));
  await page.goto('/');
  const movie = options.video ? await tinyMovie(page) : Buffer.alloc(0);
  if (options.video) expect(movie.byteLength).toBeGreaterThan(0);
  await page.route(`**/api/media/${videoId}`, route => route.fulfill({ body: movie, contentType: 'video/mp4' }));
  await login(page);
  return { requests, mutations, errors };
}
function scriptButton(page: Page, taskName: string, skillName: string) {
  return page.getByRole('button', { name: `查看任务脚本：${taskName} · ${skillName}`, exact: true });
}

test('任务栏并列显示商品和脚本封面，用中文状态替代纯进度条且兼容旧摘要', async ({ page }, info) => {
  const summaries = [
    task(1, '6258黑色换装', 'waiting', [imageSkill]), task(2, '6258深蓝换装', 'ready', [imageSkill]),
    task(3, '响应中断任务', 'unknown', [imageSkill]), task(4, '生成失败任务', 'failed', [imageSkill]),
    task(5, '旧版摘要任务', 'queued'), task(6, '结果待修正任务', 'invalid', [imageSkill]),
  ];
  const tracked = await prepare(page, summaries, { emptySkills: true });
  const board = page.getByRole('complementary', { name: '任务栏' });
  const working = board.getByRole('article', { name: summaries[0].name, exact: true });
  const cover = scriptButton(page, summaries[0].name, imageSkill.name);
  await expect(cover.getByAltText(`脚本封面：${imageSkill.name}`)).toBeVisible();
  await expect(working.getByAltText(`商品主图：${summaries[0].name}`)).toBeVisible();
  await expect(cover).toHaveAttribute('title', `所用脚本：${imageSkill.name}`);
  for (const [index, label] of ['正在生成', '已完成', '连接中断', '生成失败', '排队中', '结果需修正'].entries()) {
    const card = board.getByRole('article', { name: summaries[index].name, exact: true });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText(label, { exact: true })).toBeVisible();
    await expect(card.getByRole('progressbar')).toHaveCount(0);
    if (index > 1) await expect(card.getByText('已完成', { exact: true })).toHaveCount(0);
  }
  await expect(board.getByRole('article', { name: '旧版摘要任务' })).toBeVisible();
  await working.scrollIntoViewIfNeeded();
  await board.screenshot({ path: info.outputPath('task-board-cover-status.png') });
  expect(tracked.requests.filter(url => url === `/api/media/${videoId}`)).toHaveLength(0);
  expect(tracked.mutations).toEqual([]); expect(tracked.errors).toEqual([]);
});

test('视频首帧不自动播放，失效封面只回退一次，所有脚本封面点击进入该任务', async ({ page }) => {
  const summary = task(7, '组合脚本任务', 'ready', [imageSkill, movieSkill, emptySkill, brokenSkill, unavailableSkill]);
  const tracked = await prepare(page, [summary], { video: true, emptySkills: true });
  const card = page.getByRole('complementary', { name: '任务栏' }).getByRole('article', { name: summary.name });
  await expect(scriptButton(page, summary.name, imageSkill.name).locator('img')).toBeVisible();
  for (const skill of [movieSkill, brokenSkill]) {
    const button = scriptButton(page, summary.name, skill.name); await button.scrollIntoViewIfNeeded();
    const video = button.locator('video'); await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', `/api/media/${videoId}`);
    await expect(video).toHaveJSProperty('muted', true); await expect(video).toHaveJSProperty('autoplay', false);
    await expect(video).toHaveJSProperty('paused', true); await expect(video).toHaveAttribute('preload', 'metadata');
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  }
  const missing = scriptButton(page, summary.name, emptySkill.name); await missing.scrollIntoViewIfNeeded();
  await expect(missing.getByText('无封面', { exact: true })).toBeVisible();
  const unavailable = scriptButton(page, summary.name, unavailableSkill.name); await unavailable.scrollIntoViewIfNeeded();
  await expect(unavailable.getByText('无封面', { exact: true })).toBeVisible();
  const initialBrokenImageCount = tracked.requests.filter(url => url === `/api/media/${brokenImageId}`).length;
  const initialBrokenVideoCount = tracked.requests.filter(url => url === `/api/media/${brokenVideoId}`).length;
  expect(initialBrokenImageCount).toBeGreaterThan(0); expect(initialBrokenImageCount).toBeLessThanOrEqual(2);
  expect(initialBrokenVideoCount).toBe(1);
  // Trigger a real task-board refresh without changing the asset IDs. The same missing IDs must not loop.
  await page.evaluate(() => window.dispatchEvent(new Event('workbench:tasks-changed')));
  await expect.poll(() => tracked.requests.filter(url => url === '/api/task-board').length).toBeGreaterThan(1);
  await expect(unavailable.getByText('无封面', { exact: true })).toBeVisible();
  expect(tracked.requests.filter(url => url === `/api/media/${brokenImageId}`)).toHaveLength(initialBrokenImageCount);
  expect(tracked.requests.filter(url => url === `/api/media/${brokenVideoId}`)).toHaveLength(initialBrokenVideoCount);
  await scriptButton(page, summary.name, imageSkill.name).scrollIntoViewIfNeeded();
  await scriptButton(page, summary.name, imageSkill.name).click();
  await expect(page).toHaveURL(new RegExp(`#task/${summary.id}$`));
  expect(tracked.requests.filter(url => /^\/api\/skills\//.test(url))).toEqual([]);
  expect(tracked.mutations).toEqual([]); expect(tracked.errors).toEqual([]);
  await expect(card).toHaveCount(0);
});

test('记录页每行保留商品主图和全部组合脚本，窄桌面不溢出且缩略图可打开详情', async ({ page }, info) => {
  const skills = Array.from({ length: 6 }, (_, index) => preview(10 + index, `组合脚本${index + 1}完整名称`, imageId));
  const summaries = [task(10, '6258三色组合', 'ready', skills), task(11, '旧摘要仍可打开', 'ready')];
  const tracked = await prepare(page, summaries, { emptySkills: true });
  await page.getByRole('link', { name: '生成记录', exact: true }).click();
  const history = page.getByRole('article', { name: summaries[0].name, exact: true });
  await expect(page.getByRole('complementary', { name: '任务栏' })).toHaveCount(0);
  await expect(history.getByAltText(`商品主图：${summaries[0].name}`)).toBeVisible();
  await expect(history.getByRole('button', { name: /^查看任务脚本：/ })).toHaveCount(6);
  for (const skill of skills) {
    const button = scriptButton(page, summaries[0].name, skill.name);
    await button.scrollIntoViewIfNeeded(); await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('title', `所用脚本：${skill.name}`);
    await expect(button.getByAltText(`脚本封面：${skill.name}`)).toBeVisible();
  }
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(history.getByRole('button', { name: '打开', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`history-product-scripts-${width}.png`), fullPage: true });
  }
  await history.getByRole('button', { name: `查看任务：${summaries[0].name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#task/${summaries[0].id}$`));
  expect(tracked.requests.filter(url => /^\/api\/skills\//.test(url))).toEqual([]);
  expect(tracked.mutations).toEqual([]); expect(tracked.errors).toEqual([]);
});

test('任务栏多卡不逐项获取脚本详情，未进入视口的视频不批量取流', async ({ page }, info) => {
  const summaries = Array.from({ length: 20 }, (_, index) => task(100 + index, `任务 ${index + 1}`, 'ready', [preview(100 + index, `脚本 ${index + 1}`, imageId)]));
  summaries[19].skillPreviews = [preview(900, '视口外视频', null, videoId)];
  const tracked = await prepare(page, summaries, { video: true, emptySkills: true });
  const board = page.getByRole('complementary', { name: '任务栏' });
  await expect(board.getByRole('article')).toHaveCount(20);
  await expect(scriptButton(page, summaries[0].name, '脚本 1').locator('img')).toBeVisible();
  expect(tracked.requests.filter(url => url === `/api/media/${videoId}`)).toHaveLength(0);
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await board.screenshot({ path: info.outputPath(`task-board-${width}.png`) });
  }
  const last = scriptButton(page, summaries[19].name, '视口外视频'); await last.scrollIntoViewIfNeeded();
  await expect(last.locator('video')).toHaveAttribute('src', `/api/media/${videoId}`);
  await expect.poll(() => tracked.requests.filter(url => url === `/api/media/${videoId}`).length).toBeGreaterThan(0);
  expect(tracked.requests.filter(url => /^\/api\/skills\//.test(url))).toEqual([]);
  expect(tracked.mutations).toEqual([]); expect(tracked.errors).toEqual([]);
});
