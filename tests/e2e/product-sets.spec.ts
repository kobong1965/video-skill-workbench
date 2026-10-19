import { test, expect, type Page } from './fixtures';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
}

async function mutate(page: Page, url: string, body: unknown, method = 'POST') {
  return page.evaluate(async ({ url, body, method }) => {
    const { csrf } = await (await fetch('/api/me')).json();
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result;
  }, { url, body, method });
}

async function fillNewProductSet(page: Page, styleNumber: string, name: string) {
  const create = page.getByRole('button', { name: '新建产品图套', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  const dialog = page.getByRole('dialog', { name: '新建产品图套', exact: true });
  await dialog.getByLabel('款号', { exact: true }).fill(styleNumber);
  await dialog.getByLabel('商品名称', { exact: true }).fill(name);
  const buffer = await readFile(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await dialog.getByLabel('上传图套图片', { exact: true }).setInputFiles([
    { name: `${styleNumber}-front.png`, mimeType: 'image/png', buffer },
    { name: `${styleNumber}-back.png`, mimeType: 'image/png', buffer },
  ]);
  await expect(dialog.getByRole('button', { name: '保存产品图套', exact: true })).toBeEnabled();
  return dialog;
}

test('任务栏只在创作页出现，脚本选择不再显示搜索和重复脚本库入口', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('complementary', { name: '任务栏', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '搜索 Skill', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '脚本库', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '脚本库', exact: true })).toBeVisible();
  for (const name of ['脚本库', '生成记录', '参考图库', '管理设置']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: '任务栏', exact: true })).toHaveCount(0);
    const content = await page.locator('.workspace-content').boundingBox();
    const available = await page.locator('.workspace-with-tasks').boundingBox();
    expect(content!.width).toBeGreaterThanOrEqual(available!.width - 2);
  }
  await page.goto('/#task/91919191-9191-4191-8191-919191919191');
  await expect(page.getByRole('heading', { name: '提示词', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '任务栏', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '任务栏', exact: true })).toBeVisible();
});

test('产品图套按款号保存并跨刷新复用，选款不重传图片且仍需脚本和下一步设置', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let mediaUploads = 0; let generations = 0;
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname === '/api/media') mediaUploads++;
    if (request.method() === 'POST' && /\/generate$/.test(pathname)) generations++;
  });
  await login(page);
  const skill = await mutate(page, '/api/skills', { name: '款号复用开头脚本', kind: 'opening', duration: 3, text: '# 开头\n保持上传商品外观，短暂惊讶后展示商品。', visibility: 'private' });
  await page.getByRole('link', { name: '参考图库', exact: true }).click();
  await expect(page.getByRole('tab', { name: '产品图套', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '参考图', exact: true })).toBeVisible();
  const dialog = await fillNewProductSet(page, 'SKU-SET-5007', '细条纹阔腿裤');
  const savedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/product-sets');
  await dialog.getByRole('button', { name: '保存产品图套', exact: true }).click();
  const saved = await (await savedResponse).json();
  expect(saved.styleNumber).toBe('SKU-SET-5007');
  expect(saved.name).toBe('细条纹阔腿裤');
  expect(saved.media).toHaveLength(2);
  expect(saved.media.map((media: { role: string }) => media.role)).toEqual(['product', 'detail']);
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'SKU-SET-5007', exact: true })).toBeVisible();
  const persisted = await (await page.request.get(`/api/product-sets/${saved.id}`)).json();
  expect(persisted.media.map((media: { id: string }) => media.id)).toEqual(saved.media.map((media: { id: string }) => media.id));
  await page.screenshot({ path: info.outputPath('product-sets-library.png'), fullPage: true });
  const uploadsBeforeReuse = mediaUploads;
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('button', { name: '选择款号', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择款号', exact: true });
  await picker.getByLabel('搜索款号', { exact: true }).fill('SKU-SET-5007');
  await picker.getByRole('button', { name: '选择款号：SKU-SET-5007', exact: true }).click();
  await expect(picker.getByRole('button', { name: '选择款号：SKU-SET-5007', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: '使用所选款号', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const product = page.locator('.creation-product');
  await expect(product).toContainText('SKU-SET-5007');
  await expect(product.locator('.product-tile img')).toHaveCount(2);
  await expect(page.getByLabel('图片 1 用途', { exact: true })).toHaveValue('product');
  await expect(page.getByLabel('图片 2 用途', { exact: true })).toHaveValue('detail');
  expect(mediaUploads).toBe(uploadsBeforeReuse);
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await expect(page.getByText('请选择一个或多个脚本', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `选择脚本：${skill.name}`, exact: true }).click();
  expect(generations).toBe(0);
  await page.screenshot({ path: info.outputPath('product-set-reused-in-creation.png'), fullPage: true });
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '生成设置', exact: true });
  await expect(settings.getByRole('heading', { name: '常规设置', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: '生成提示词', exact: true })).toBeVisible();
  expect(generations).toBe(0);
  expect(mediaUploads).toBe(uploadsBeforeReuse);
  expect(errors).toEqual([]);
});

test('重复款号拒绝保存但保留输入和图套，参考图旧入口继续可用', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '参考图库', exact: true }).click();
  const original = await fillNewProductSet(page, 'SKU-DUP-6020', '原始款号商品');
  await original.getByRole('button', { name: '保存产品图套', exact: true }).click();
  await expect(original).toHaveCount(0);
  const duplicate = await fillNewProductSet(page, 'SKU-DUP-6020', '不要丢失的输入');
  const rejected = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/product-sets');
  await duplicate.getByRole('button', { name: '保存产品图套', exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(duplicate.getByRole('alert')).toBeVisible();
  await expect(duplicate.getByLabel('款号', { exact: true })).toHaveValue('SKU-DUP-6020');
  await expect(duplicate.getByLabel('商品名称', { exact: true })).toHaveValue('不要丢失的输入');
  await expect(duplicate.locator('img')).toHaveCount(2);
  const sets = await (await page.request.get('/api/product-sets')).json();
  expect(sets.filter((set: { styleNumber: string }) => set.styleNumber === 'SKU-DUP-6020')).toHaveLength(1);
  await duplicate.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('tab', { name: '参考图', exact: true }).click();
  await page.getByRole('button', { name: /＋ 上传参考图/ }).click();
  const reference = page.getByRole('dialog', { name: '上传已有参考图', exact: true });
  await reference.getByLabel('选择图片', { exact: true }).setInputFiles(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  await reference.getByLabel('参考图名称', { exact: true }).fill('保留的旧参考图上传');
  await reference.getByRole('button', { name: '上传参考图', exact: true }).click();
  await expect(reference).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '保留的旧参考图上传', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认这张图', exact: true })).toBeVisible();
});

test('离开素材页后迟到的图套读取不会把用户拉回创作页', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '参考图库', exact: true }).click();
  const dialog = await fillNewProductSet(page, 'SKU-LATE-7030', '延迟读取图套');
  const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/product-sets');
  await dialog.getByRole('button', { name: '保存产品图套', exact: true }).click();
  const set = await (await created).json();
  await expect(dialog).toHaveCount(0);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/product-sets/${set.id}`, async route => { await pending; await route.fulfill({ json: set }); });
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === `/api/product-sets/${set.id}`);
  await page.getByRole('button', { name: '使用图套：SKU-LATE-7030', exact: true }).click();
  await requested;
  try {
    await page.getByRole('link', { name: '生成记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生成记录', exact: true })).toBeVisible();
    const delivered = page.waitForResponse(response => new URL(response.url()).pathname === `/api/product-sets/${set.id}`);
    release(); await delivered;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page).toHaveURL(/#history$/);
  } finally { release(); }
});
