import { test, expect, type Page } from './fixtures';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

async function request(page: Page, url: string, body: Record<string, unknown>) {
  const { csrf } = await (await page.request.get('/api/me')).json();
  const response = await page.request.post(url, { data: body, headers: { 'X-CSRF-Token': csrf, origin: new URL(page.url()).origin } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  const { csrf } = await (await page.request.get('/api/me')).json();
  const response = await page.request.post('/api/media', { multipart: { file: { name, mimeType, buffer } }, headers: { 'X-CSRF-Token': csrf, origin: new URL(page.url()).origin } });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('卡片支持视频播放、图片预览、空状态和失败反馈，预览不改变脚本勾选', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('登录账号').fill('preview-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台' })).toBeVisible();
  // Produce a tiny real MP4 in the isolated test browser; no downloads or AI calls.
  const recording = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 240;
    const drawing = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' });
    const parts: Blob[] = [];
    recorder.ondataavailable = event => parts.push(event.data);
    const finished = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(parts, { type: 'video/mp4' })); });
    let frame = 0;
    const timer = setInterval(() => { drawing.fillStyle = frame++ % 2 ? '#e3edff' : '#fff5d6'; drawing.fillRect(0, 0, 180, 240); }, 100);
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 1500)); recorder.stop();
    const result = await finished; clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return btoa(String.fromCharCode(...new Uint8Array(await result.arrayBuffer())));
  });
  const movie = await upload(page, 'effect.mp4', 'video/mp4', Buffer.from(recording, 'base64'));
  const picture = await upload(page, 'cover.png', 'image/png', await readFile(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png')));
  const videoSkill = await request(page, '/api/skills', { name: '视频预览样例', kind: 'opening', duration: 3, text: '# 测试开头', tags: ['视频测试'], visibility: 'private' });
  const imageSkill = await request(page, '/api/skills', { name: '图片预览样例', kind: 'full', duration: 17, text: '# 测试全片', tags: ['只有图片'], visibility: 'private' });
  await request(page, '/api/skills', { name: '无素材样例', kind: 'detail', duration: 7, text: '# 测试细节', visibility: 'private' });
  await request(page, `/api/skills/${videoSkill.id}/preview`, { mediaId: movie.id });
  await request(page, `/api/skills/${videoSkill.id}/preview`, { mediaId: picture.id });
  await request(page, `/api/skills/${imageSkill.id}/preview`, { mediaId: picture.id });
  await page.reload();
  const select = page.getByRole('button', { name: '选择脚本：图片预览样例', exact: true });
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '播放效果视频：视频预览样例', exact: true }).click();
  const player = page.getByRole('dialog').locator('video');
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await expect(player).toHaveJSProperty('controls', true);
  const detachedPlayer = await player.elementHandle();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  expect(await detachedPlayer!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '选择脚本：视频预览样例', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const imageButton = page.getByRole('button', { name: '查看参考图片：图片预览样例', exact: true });
  await imageButton.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByAltText('图片预览样例参考图片')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('尚未包含效果视频');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(imageButton).toBeFocused();
  await expect(page.getByRole('img', { name: '无素材样例暂无预览素材' })).toBeVisible();
  await page.getByLabel('需要组合多个片段').check();
  await page.getByRole('button', { name: '选择脚本：视频预览样例', exact: true }).click();
  await page.getByRole('button', { name: '播放效果视频：视频预览样例', exact: true }).click();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByRole('button', { name: /^选择脚本：/, pressed: true })).toHaveCount(2);
  const root = 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/preview-0.1.3/screenshots';
  await mkdir(root, { recursive: true });
  for (const width of [1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.screenshot({ path: path.join(root, `cards-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.route(`**/api/media/${picture.id}`, route => route.fulfill({ status: 404, body: 'missing test media' }));
  await imageButton.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('素材暂时无法显示');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  // A package requirement must follow the exact version through every reuse entry.
  const packageFile = await upload(page, 'required-reference.zip', 'application/zip', Buffer.from(zipSync({
    'sample/SKILL.md': strToU8('# 对标版测试\n全片，需同步对标。'),
    'sample/workbench.json': strToU8(JSON.stringify({ referenceVideoRequired: true, benchmarkVideo: 'assets/benchmark/original.mp4' })),
    'sample/assets/benchmark/original.mp4': Buffer.from(recording, 'base64'),
    'sample/assets/approved/result.mp4': Buffer.from(recording, 'base64'),
  })));
  const protectedSkill = await request(page, '/api/skills', { mediaId: packageFile.id, name: '同步对标测试', kind: 'full', duration: 14, visibility: 'private' });
  expect(protectedSkill.requirements.referenceVideoRequired).toBe(true);
  expect(protectedSkill.requirements.benchmarkVideo.path).toContain('/benchmark/');
  await page.unroute(`**/api/media/${picture.id}`);
  await page.reload();
  const ordinary = page.getByRole('button', { name: '选择脚本：图片预览样例', exact: true });
  const guarded = page.getByRole('button', { name: '选择脚本：同步对标测试', exact: true });
  await ordinary.click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await guarded.click();
  const notice = page.getByRole('dialog', { name: '使用此 Skill 需同步上传对标视频' });
  await expect(notice).toContainText('商品图 ＋ 原始完整对标视频');
  await expect(notice).toContainText('不代表素材已上传到 LibTV');
  const link = notice.getByRole('link', { name: '下载原始对标视频' });
  await expect(link).toHaveAttribute('href', `/api/media/${protectedSkill.requirements.benchmarkVideo.mediaId}?download=1`);
  const download = await page.request.get((await link.getAttribute('href'))!);
  expect(download.ok()).toBe(true); expect(download.headers()['content-disposition']).toContain('attachment');
  await page.keyboard.press('Escape');
  await expect(notice).toHaveCount(0); await expect(ordinary).toHaveAttribute('aria-pressed', 'true');
  await expect(guarded).toHaveAttribute('aria-pressed', 'false'); await expect(guarded).toBeFocused();
  await guarded.click(); await notice.getByRole('button', { name: '我已了解，继续使用' }).click();
  await expect(guarded).toHaveAttribute('aria-pressed', 'true'); await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: '查看要求与下载对标' }).click(); await expect(notice).toBeVisible();
  const evidence = 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/reference-0.1.5';
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'reference-popup.png'), fullPage: true });
  await notice.getByRole('button', { name: '我已了解，继续使用' }).click();
  await page.getByRole('link', { name: '脚本库', exact: true }).click();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '同步对标测试' }) });
  await card.getByRole('button', { name: '使用这个脚本' }).click(); await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '我已了解，继续使用' }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  // Old drafts must retain their original requirement even after a newer unguarded version.
  const drafts = await (await page.request.get('/api/drafts')).json();
  const saved = drafts.find((draft: { input: { selections?: { versionId: string }[] } }) => draft.input.selections?.some(item => item.versionId === protectedSkill.versionId));
  expect(saved).toBeTruthy();
  const plainFile = await upload(page, 'plain.md', 'text/markdown', Buffer.from('# 普通新版全片'));
  await request(page, `/api/skills/${protectedSkill.id}/versions`, { mediaId: plainFile.id, kind: 'full', duration: 14 });
  await page.getByRole('link', { name: '生成记录', exact: true }).click();
  await page.getByRole('button', { name: '继续创作', exact: true }).first().click();
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '取消使用' }).click(); await expect(notice).toHaveCount(0);
  expect(errors).toEqual([]);
});
