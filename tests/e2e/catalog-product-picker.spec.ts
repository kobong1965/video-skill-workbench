import { test, expect, type Page } from './fixtures';
import type { CatalogSnapshot } from '../../packages/contracts/product-catalog';

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240"><rect width="200" height="240" fill="#eef0f5"/><path d="M60 30h80l-4 190h-30l-6-130-6 130H64z" fill="#5264a9"/></svg>';
const catalog: CatalogSnapshot = {
  products: [0, 1, 2, 3].map(index => ({ id: `SKU-${index}`, productUid: uid(index + 1), category: index ? 'men' : 'women', sku: index ? `6258-${index}` : 'H9002', name: index ? '男装牛仔裤' : '双扣微喇裤', title: '', sizes: [], note: '', coverId: 'main', folders: [], sourceMissing: index === 3,
    assets: [{ id: 'main', kind: 'main', label: '主图', available: true, mediaType: 'image', url: `/api/product-catalog/${uid(index + 1)}/assets/main` }],
    shopBindings: [{ shopName: index ? 'DEMOB' : 'DEMA', market: 'US', productId: `910000000000000400${index}`, productUrl: null, matchStatus: index === 2 ? 'pending' : 'image_matched' }],
  })), sourceHash: 'a'.repeat(64), syncedAt: '2026-11-04T00:00:00Z', sourceUpdatedAt: '2026-11-03T00:00:00Z', stale: false, error: null, sourceLabel: '测试产品表', counts: { products: 4, men: 3, women: 1, images: 4, videos: 0, folders: 0 },
};

async function setup(page: Page) {
  const state = { snapshot: structuredClone(catalog), selections: [] as any[], drafts: [] as any[], writes: 0, sideEffects: [] as string[], delaySelection: undefined as Promise<void> | undefined };
  await page.route('**/api/config', async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), singleUserMode: true } }); });
  await page.route('**/api/product-sets', route => route.fulfill({ json: [{ id: uid(90), styleNumber: '手动6258', name: '原有图套', createdAt: '', updatedAt: '', media: [{ id: uid(91), role: 'product', name: '原图.png' }] }] }));
  await page.route(`**/api/product-sets/${uid(90)}`, route => route.fulfill({ json: { id: uid(90), styleNumber: '手动6258', name: '原有图套', createdAt: '', updatedAt: '', media: [{ id: uid(91), role: 'product', name: '原图.png' }] } }));
  await page.route('**/api/media/*', route => route.fulfill({ contentType: 'image/svg+xml', body: image }));
  await page.route('**/api/product-catalog**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes('/assets/')) { await route.fulfill({ contentType: 'image/svg+xml', body: image }); return; }
    if (pathname.endsWith('/selections') && route.request().method() === 'POST') {
      state.writes++; const input = route.request().postDataJSON(); const product = state.snapshot.products.find(item => item.productUid === input.productUid)!;
      expect(input.binding).toEqual({ shopName: product.shopBindings[0].shopName, market: 'US', productId: product.shopBindings[0].productId });
      const id = uid(100 + state.writes); const mediaId = uid(200 + state.writes);
      const saved = { id, source: 'catalog', styleNumber: product.sku, name: product.name, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
        media: [{ id: mediaId, role: 'product', name: '主图.png' }], catalog: { selectionId: id, productUid: product.productUid, category: product.category, sku: product.sku, name: product.name,
          binding: product.shopBindings[0], sourceHash: input.sourceHash, sourceUpdatedAt: state.snapshot.sourceUpdatedAt, selectedAt: '2026-11-04T00:00:00Z', assets: [{ assetId: 'main', mediaId, kind: 'main', role: 'product', digest: 'b'.repeat(64), name: '主图.png' }] } };
      state.selections.push(saved); if (state.delaySelection) await state.delaySelection;
      await route.fulfill({ json: saved }); return;
    }
    if (pathname.includes('/selections/')) { await route.fulfill({ json: state.selections.find(item => pathname.endsWith(item.id)) }); return; }
    await route.fulfill({ json: state.snapshot });
  });
  await page.route('**/api/drafts', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: state.drafts }); return; }
    const body = route.request().postDataJSON(); const record = { id: body.id || uid(500), name: body.name || '测试草稿', input: body.input, updatedAt: '2026-11-04T00:00:00Z' };
    state.drafts = [record]; await route.fulfill({ json: { id: record.id } });
  });
  page.on('request', request => { if (request.method() === 'POST' && /\/(generate|tasks|imports)$/.test(new URL(request.url()).pathname)) state.sideEffects.push(request.url()); });
  await page.goto('/'); await page.getByLabel('登录账号').fill('e2e-admin'); await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click(); await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
  return state;
}
async function open(page: Page) {
  await page.getByRole('button', { name: '选择款号', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '选择款号', exact: true });
  await expect(modal.getByRole('button', { name: /^选择款号：/ })).toHaveCount(5); return modal;
}

test('产品表款号带完整ID选用，调序、草稿恢复和手动图套切换保留正确身份', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const state = await setup(page); const modal = await open(page);
  await modal.getByLabel('款号分类').selectOption('women'); await expect(modal.getByRole('button', { name: /^选择款号：/ })).toHaveCount(1);
  await modal.getByRole('button', { name: '选择款号：H9002 · DEMA · 9100000000000004000', exact: true }).click();
  await modal.getByLabel('款号分类').selectOption(''); await modal.getByLabel('搜索款号').fill('9100000000000004001');
  await modal.getByRole('button', { name: '选择款号：6258-1 · DEMOB · 9100000000000004001', exact: true }).click();
  expect(state.writes).toBe(0); await modal.screenshot({ path: info.outputPath('catalog-picker.png') });
  await modal.getByRole('button', { name: '使用所选款号', exact: true }).click(); await expect(modal).toHaveCount(0);
  expect(state.writes).toBe(2); await expect(page.locator('.creation-product .product-tile')).toHaveCount(2);
  const groups = page.getByRole('list', { name: '本次款号', exact: true });
  await expect(groups).toContainText('9100000000000004000'); await expect(groups).toContainText('9100000000000004001');
  await page.getByRole('button', { name: '上移款号：6258-1', exact: true }).click();
  await page.getByRole('radio', { name: '搭配', exact: true }).click();
  await expect(page.getByRole('radio', { name: '搭配', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => state.drafts[0]?.input.productGroups?.[0].catalog?.binding.productId).toBe('9100000000000004001');
  expect(state.drafts[0].input.market).toBe('US'); expect(state.drafts[0].input.platform).toBe('tiktok');
  await page.getByRole('link', { name: '生成记录', exact: true }).click();
  await page.getByRole('button', { name: '继续创作', exact: true }).click();
  await expect(groups).toContainText('9100000000000004000'); expect(state.writes).toBe(2);
  await page.screenshot({ path: info.outputPath('catalog-groups-restored.png') });
  const again = await open(page);
  const removeButtons = again.getByRole('button', { name: /^移除款号：/ });
  while (await removeButtons.count()) await removeButtons.first().click();
  await again.getByRole('button', { name: '选择款号：手动6258', exact: true }).click();
  await again.getByRole('button', { name: '使用所选款号', exact: true }).click();
  await expect(groups).toContainText('手动6258'); await expect(groups).not.toContainText('商品 ID');
  expect(state.sideEffects).toEqual([]); expect(errors).toEqual([]);
});

test('缺失和未确认绑定不能选，刷新清理未载入选择，窄屏可用且取消不导入', async ({ page }, info) => {
  const state = await setup(page); let modal = await open(page);
  await expect(modal.getByRole('button', { name: /选择款号：6258-2/ })).toBeDisabled();
  await expect(modal.getByRole('button', { name: /选择款号：6258-3/ })).toBeDisabled();
  await modal.getByRole('button', { name: /选择款号：H9002/ }).click();
  await modal.getByRole('button', { name: '同步产品表', exact: true }).click();
  await expect(modal.getByRole('button', { name: '使用所选款号', exact: true })).toBeDisabled();
  await expect(modal.getByText(/请重新勾选未载入的产品/)).toBeVisible();
  await modal.getByRole('button', { name: /选择款号：H9002/ }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 900 }); await modal.screenshot({ path: info.outputPath('catalog-picker-narrow.png') });
  await modal.getByRole('button', { name: '取消', exact: true }).click(); expect(state.writes).toBe(0);
  state.snapshot.stale = true; state.snapshot.error = '测试同步不可用'; modal = await open(page);
  await expect(modal.getByRole('button', { name: /选择款号：H9002/ })).toBeDisabled();
  await expect(modal.getByText('测试同步不可用')).toBeVisible(); expect(state.sideEffects).toEqual([]);
});

test('使用时关闭弹窗，迟到响应不覆盖创作且不继续载入下一款', async ({ page }) => {
  const state = await setup(page); let release!: () => void; state.delaySelection = new Promise(resolve => { release = resolve; });
  const modal = await open(page);
  await modal.getByRole('button', { name: /选择款号：H9002/ }).click(); await modal.getByRole('button', { name: /选择款号：6258-1/ }).click();
  await modal.getByRole('button', { name: '使用所选款号', exact: true }).click(); await expect.poll(() => state.writes).toBe(1);
  await modal.getByRole('button', { name: '取消', exact: true }).click(); release();
  await expect(page.locator('.creation-product .product-tile')).toHaveCount(0);
  await page.getByRole('button', { name: '选择款号', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('button', { name: '使用所选款号', exact: true })).toBeDisabled();
  expect(state.writes).toBe(1); expect(state.sideEffects).toEqual([]);
});
