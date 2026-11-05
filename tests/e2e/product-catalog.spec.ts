import { test, expect, type Page } from './fixtures';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const image = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#e9e5f5"/><path d="M85 50h130l-10 300h-50l-5-190-5 190H95z" fill="#5264a9"/></svg>';
const asset = (id: string, kind: 'main' | 'detail' | 'reference' | 'video', label: string, available = true) => ({ id, kind, label, available, mediaType: kind === 'video' ? 'video' : 'image', url: `/api/product-catalog/women-1/assets/${id}` });
const products = [
  { id: 'SKU-H9002', productUid: 'women-1', category: 'women', sku: 'H9002', name: '蓝色双扣微喇', title: 'Blue Flared Jeans', sizes: ['XS', 'S', 'M'], note: '女装资料', coverId: 'main-1', sourceMissing: false, assets: [asset('main-1', 'main', '正面封面'), asset('detail-1', 'detail', '双扣细节'), asset('reference-1', 'reference', '穿搭参考'), asset('video-1', 'video', '成片视频')], folders: [{ id: 'folder-1', label: '款式资料', available: true }], shopBindings: [{ shopName: 'DEMA', market: 'US', productId: '9100000000000003001', productUrl: null, matchStatus: 'matched', matchedOn: '2026-10-30', sourceType: 'catalog', visualMatchNotes: '核对蓝色双扣微喇外观', evidence: [] }] },
  { id: 'SKU-6258', productUid: 'men-1', category: 'men', sku: '6258', name: '深灰阔腿裤', title: '', sizes: ['M', 'L'], note: '', coverId: 'main-2', sourceMissing: false, assets: [asset('main-2', 'main', '男装主图')], folders: [], shopBindings: [{ shopName: 'DEMOB', market: 'US', productId: '9100000000000003002', productUrl: null, matchStatus: 'matched' }] },
  { id: 'SKU-6258-1', productUid: 'men-variant', category: 'men', sku: '6258', name: '深灰阔腿裤独立款', title: '', sizes: [], note: '', coverId: 'missing', sourceMissing: true, assets: [asset('missing', 'main', '缺失主图', false)], folders: [{ id: 'missing-folder', label: '原资料', available: false }], shopBindings: [{ shopName: 'SECOND', market: 'US', productId: '9100000000000003003', productUrl: null, matchStatus: 'unverified' }] },
];
const snapshot = { products, syncedAt: '2026-10-31T02:00:00.000Z', sourceUpdatedAt: '2026-10-30T02:00:00.000Z', sourceHash: 'test-hash', stale: false, error: null, sourceLabel: '美区产品表', counts: { products: 3, men: 2, women: 1, images: 5, videos: 1, folders: 2 } };

async function setup(page: Page, singleUserMode = true) {
  const calls = { sync: 0, opened: [] as string[], catalog: 0, generation: 0, stale: false, empty: false, denied: false, httpError: false, imageMissing: false };
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), singleUserMode } });
  });
  await page.route('**/api/product-catalog**', async route => {
    const url = new URL(route.request().url()); calls.catalog++;
    if (calls.denied) { await route.fulfill({ status: 403, json: { error: '仅限本机管理员使用产品表' } }); return; }
    if (calls.httpError && route.request().method() === 'POST') { await route.fulfill({ status: 503, json: { error: '同步服务暂时不可用' } }); return; }
    if (url.pathname.includes('/assets/')) { await route.fulfill({ status: calls.imageMissing ? 404 : 200, contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: calls.imageMissing ? '' : image }); return; }
    if (url.pathname.endsWith('/open')) { calls.opened.push(url.pathname); await route.fulfill({ json: { opened: true } }); return; }
    if (route.request().method() === 'POST') calls.sync++;
    await route.fulfill({ json: calls.empty ? { ...snapshot, products: [], syncedAt: null, counts: { products: 0, men: 0, women: 0, images: 0, videos: 0, folders: 0 } } : { ...snapshot, stale: calls.stale, error: calls.stale ? '源清单暂时不可用' : null } });
  });
  page.on('request', request => { if (request.method() === 'POST' && /\/(generate|jobs|tasks)$/.test(new URL(request.url()).pathname)) calls.generation++; });
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
  return calls;
}

test('产品表区分分类和店铺，保留完整商品 ID、素材分类与创作输入', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls = await setup(page);
  await page.getByLabel('上传商品图', { exact: true }).setInputFiles({ name: '保留创作图.png', mimeType: 'image/png', buffer: await readFile(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png')) });
  await expect(page.locator('.creation-product .product-tile img')).toHaveCount(1);
  await page.getByRole('link', { name: '产品表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '产品表', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '女装 1 款', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '男装 2 款', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '女装 1 款', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '男装 2 款', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '男装 2 款', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('complementary', { name: '任务栏', exact: true })).toHaveCount(0);
  const detail = page.getByRole('region', { name: '产品详情', exact: true });
  await expect(detail.getByRole('heading', { name: 'H9002 蓝色双扣微喇', exact: true })).toBeVisible();
  await expect(detail.getByText('9100000000000003001', { exact: true })).toBeVisible();
  await expect(detail.getByText('商品链接：未提供', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制 DEMA 商品 ID', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '商品 ID 已复制' })).toBeVisible();
  await detail.getByRole('button', { name: '预览原图：正面封面', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '正面封面', exact: true }).getByRole('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: '预览原图：正面封面', exact: true })).toBeFocused();
  await detail.getByRole('button', { name: '详情图 1', exact: true }).click();
  await expect(detail.getByRole('button', { name: '预览原图：双扣细节', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '参考图 1', exact: true }).click();
  await expect(detail.getByRole('button', { name: '预览原图：穿搭参考', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '视频 1', exact: true }).click();
  await expect(detail.locator('video')).toHaveAttribute('preload', 'none');
  await expect(detail.locator('video')).toHaveAttribute('controls', '');
  await detail.locator('video').dispatchEvent('error');
  await expect(detail.getByRole('alert')).toContainText('视频暂时无法播放');
  await page.getByRole('button', { name: '打开文件夹：款式资料', exact: true }).click();
  expect(calls.opened).toEqual(['/api/product-catalog/women-1/folders/folder-1/open']);
  await page.getByRole('tab', { name: '男装 2 款', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看款式：6258 深灰阔腿裤', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看款式：6258 深灰阔腿裤独立款', exact: true })).toBeVisible();
  await expect(detail.getByText('标题：未提供', { exact: true })).toBeVisible();
  await page.getByLabel('筛选店铺', { exact: true }).selectOption('SECOND');
  await expect(detail.getByText('9100000000000003003', { exact: true })).toBeVisible();
  await expect(detail.getByText('来源已缺失', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '打开文件夹：原资料', exact: true })).toBeDisabled();
  await expect(detail.getByText('原文件不可用', { exact: true })).toBeVisible();
  await page.getByLabel('筛选店铺', { exact: true }).selectOption('');
  await page.getByRole('searchbox', { name: '搜索产品', exact: true }).fill('9100000000000003002');
  await expect(page.getByRole('button', { name: /^查看款式：/ })).toHaveCount(1);
  await expect(detail.getByText('9100000000000003002', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('catalog-men-detail.png'), fullPage: true });
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await expect(page.locator('.creation-product .product-tile img')).toHaveCount(1);
  expect(calls.generation).toBe(0); expect(errors).toEqual([]);
});

test('同步失败保留旧资料，空镜像和无搜索结果有明确提示，窄屏不横向溢出', async ({ page }, info) => {
  const calls = await setup(page); calls.empty = true;
  await page.getByRole('link', { name: '产品表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '尚未同步产品资料', exact: true })).toBeVisible();
  calls.empty = false;
  await page.getByRole('button', { name: '同步产品资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'H9002 蓝色双扣微喇', exact: true })).toBeVisible();
  expect(calls.sync).toBe(1);
  calls.stale = true;
  await page.getByRole('button', { name: '同步产品资料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('正在显示上次有效资料');
  await expect(page.getByRole('heading', { name: 'H9002 蓝色双扣微喇', exact: true })).toBeVisible();
  expect(calls.sync).toBe(2);
  calls.httpError = true;
  await page.getByRole('button', { name: '同步产品资料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('同步服务暂时不可用');
  await expect(page.getByRole('heading', { name: 'H9002 蓝色双扣微喇', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索产品', exact: true }).fill('不存在的款号');
  await expect(page.getByRole('heading', { name: '没有匹配的款式', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: '同步产品资料', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`catalog-${width}.png`), fullPage: true });
  }
  expect(calls.generation).toBe(0);
});

test('非单用户工作台不显示本地产品入口，直接路由也不读取产品', async ({ page }) => {
  const calls = await setup(page, false);
  await expect(page.getByRole('link', { name: '产品表', exact: true })).toHaveCount(0);
  await page.goto('/#product-catalog');
  await expect(page.getByRole('status').filter({ hasText: '产品表仅供本机管理员使用' })).toBeVisible();
  expect(calls.catalog).toBe(0);
});

test('服务拒绝访问时不显示任何产品，保留明确错误和重试入口', async ({ page }) => {
  const calls = await setup(page); calls.denied = true;
  await page.getByRole('link', { name: '产品表', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('仅限本机管理员使用产品表');
  await expect(page.getByRole('button', { name: /^查看款式：/ })).toHaveCount(0);
  await expect(page.getByText('9100000000000003001', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '同步产品资料', exact: true })).toBeEnabled();
});

test('原图临时读取失败后，恢复源文件并同步可重试相同图片地址', async ({ page }) => {
  const calls = await setup(page); calls.imageMissing = true;
  await page.getByRole('link', { name: '产品表', exact: true }).click();
  const detail = page.getByRole('region', { name: '产品详情', exact: true });
  await expect(detail.getByText('原文件不可用', { exact: true })).toBeVisible();
  calls.imageMissing = false;
  await page.getByRole('button', { name: '同步产品资料', exact: true }).click();
  await expect(detail.getByRole('img', { name: '正面封面', exact: true })).toBeVisible();
  await expect(detail.getByText('原文件不可用', { exact: true })).toHaveCount(0);
});
