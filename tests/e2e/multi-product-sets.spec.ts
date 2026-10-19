import { test, expect, type Page, type Locator } from './fixtures';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

interface SavedSet {
  id: string;
  styleNumber: string;
  name: string;
  media: { id: string; role: 'product' | 'detail' | 'comparison'; name: string }[];
}
interface DraftInput {
  media: { id: string; role: string }[];
  productGroups?: { productSetId: string; styleNumber: string; name: string; mediaIds: string[] }[];
  productUse?: string;
  facts?: string;
  extra?: string;
  platform?: string;
  market?: string;
  selections?: { id: string }[];
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
}

async function create(page: Page, url: string, body: unknown) {
  const { csrf } = await (await page.request.get('/api/me')).json();
  const response = await page.request.post(url, { data: body, headers: { 'X-CSRF-Token': csrf, origin: new URL(page.url()).origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function seedSet(page: Page, styleNumber: string, count = 6): Promise<SavedSet> {
  const { csrf } = await (await page.request.get('/api/me')).json();
  const buffer = await readFile(path.join(process.env.VSW_TEST_ROOT!, 'sample-product.png'));
  const media = [];
  for (let index = 0; index < count; index++) {
    const response = await page.request.post('/api/media', {
      multipart: { file: { name: `${styleNumber}-${index + 1}.png`, mimeType: 'image/png', buffer } },
      headers: { 'X-CSRF-Token': csrf, origin: new URL(page.url()).origin },
    });
    expect(response.ok(), await response.text()).toBe(true);
    media.push({ id: (await response.json()).id as string, role: index ? 'detail' : 'product' });
  }
  return create(page, '/api/product-sets', { styleNumber, name: `${styleNumber} 测试商品`, media });
}

function observeNoAutomaticActions(page: Page) {
  const unexpected: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (pathname === '/api/media' || /\/generate$/.test(pathname))) unexpected.push(pathname);
  });
  return unexpected;
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: '选择款号', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择款号', exact: true });
  await expect(picker).toBeVisible();
  return picker;
}

async function select(picker: Locator, styleNumber: string) {
  const button = picker.getByRole('button', { name: `选择款号：${styleNumber}`, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function applyPicker(picker: Locator) {
  await picker.getByRole('button', { name: '使用所选款号', exact: true }).click();
  await expect(picker).toHaveCount(0);
}

async function latestDraft(page: Page, setId: string) {
  const drafts = await (await page.request.get('/api/drafts')).json() as { id: string; name: string; input: DraftInput }[];
  return drafts.find(draft => draft.input.productGroups?.some(group => group.productSetId === setId));
}

test('三色图套可勾选取消和排序，确认后完整载入18张而不自动上传或生成', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  const black = await seedSet(page, 'MULTI-6258黑色');
  const blue = await seedSet(page, 'MULTI-6258深蓝');
  const light = await seedSet(page, 'MULTI-6258浅蓝');
  const unexpected = observeNoAutomaticActions(page);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const picker = await openPicker(page);
  await picker.getByLabel('搜索款号', { exact: true }).fill('MULTI-6258');
  await select(picker, black.styleNumber);
  await expect(picker).toBeVisible();
  await select(picker, blue.styleNumber);
  await select(picker, light.styleNumber);
  const blueCard = picker.getByRole('button', { name: `选择款号：${blue.styleNumber}`, exact: true });
  await blueCard.click();
  await expect(blueCard).toHaveAttribute('aria-pressed', 'false');
  await expect(picker.getByRole('list', { name: '已选款号', exact: true }).getByRole('listitem')).toHaveCount(2);
  await select(picker, blue.styleNumber);
  await picker.getByRole('button', { name: `上移款号：${blue.styleNumber}`, exact: true }).click();
  await expect(picker.getByRole('list', { name: '已选款号', exact: true }).getByRole('listitem')).toHaveText([
    new RegExp(black.styleNumber), new RegExp(blue.styleNumber), new RegExp(light.styleNumber),
  ]);
  await picker.screenshot({ path: info.outputPath('three-colors-picker.png') });
  await applyPicker(picker);
  const product = page.locator('.creation-product');
  await expect(product.locator('.product-tile img')).toHaveCount(18);
  await expect(product.getByRole('list', { name: '本次款号', exact: true }).getByRole('listitem')).toHaveText([
    new RegExp(black.styleNumber), new RegExp(blue.styleNumber), new RegExp(light.styleNumber),
  ]);
  await expect(page.getByRole('radio', { name: '换色', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await expect(page.getByText('请选择一个或多个脚本', { exact: true })).toBeVisible();
  const skill = await create(page, '/api/skills', { name: '多色换装完整脚本', kind: 'full', duration: 15, text: '# 多色换装\n按图套顺序用同款三色换装，保持各组外观。', visibility: 'private' });
  await page.getByRole('link', { name: '脚本库', exact: true }).click();
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await page.getByRole('button', { name: `选择脚本：${skill.name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '生成设置', exact: true });
  await expect(settings.getByRole('heading', { name: '常规设置', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: '生成提示词', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '返回', exact: true }).click();
  await product.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('three-colors-18-images.png') });
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('换色搭配对比保留分组，主对比角色随组顺序更新并可从草稿恢复18图', async ({ page }) => {
  await login(page);
  const first = await seedSet(page, 'PERSIST-6258黑色');
  const second = await seedSet(page, 'PERSIST-6258深蓝');
  const third = await seedSet(page, 'PERSIST-6112');
  const unexpected = observeNoAutomaticActions(page);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const picker = await openPicker(page);
  for (const set of [first, second, third]) await select(picker, set.styleNumber);
  await applyPicker(picker);
  await page.getByRole('radio', { name: '搭配', exact: true }).click();
  await expect(page.getByRole('radio', { name: '搭配', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: '对比', exact: true }).click();
  await expect(page.getByRole('radio', { name: '对比', exact: true })).toBeChecked();
  await page.getByRole('button', { name: `上移款号：${second.styleNumber}`, exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(async () => (await latestDraft(page, second.id))?.input.productUse).toBe('comparison');
  const saved = (await latestDraft(page, second.id))!;
  expect(saved.input.productGroups?.map(group => group.productSetId)).toEqual([second.id, first.id, third.id]);
  expect(saved.input.productGroups?.map(group => group.styleNumber)).toEqual([second.styleNumber, first.styleNumber, third.styleNumber]);
  expect(saved.input.productGroups?.map(group => group.name)).toEqual([second.name, first.name, third.name]);
  expect(saved.input.productGroups?.map(group => group.mediaIds)).toEqual([second.media.map(file => file.id), first.media.map(file => file.id), third.media.map(file => file.id)]);
  expect(saved.input.media).toHaveLength(18);
  for (const file of saved.input.media) {
    const main = second.media.find(media => media.id === file.id);
    expect(file.role).toBe(main ? main.role : 'comparison');
  }
  await page.reload();
  await page.getByRole('link', { name: '生成记录', exact: true }).click();
  const row = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: saved.name, exact: true }) });
  await row.getByRole('button', { name: '继续创作', exact: true }).click();
  await expect(page.locator('.creation-product .product-tile img')).toHaveCount(18);
  await expect(page.getByRole('radio', { name: '对比', exact: true })).toBeChecked();
  await expect(page.getByRole('list', { name: '本次款号', exact: true }).getByRole('listitem')).toHaveText([
    new RegExp(second.styleNumber), new RegExp(first.styleNumber), new RegExp(third.styleNumber),
  ]);
  await page.getByRole('radio', { name: '换色', exact: true }).click();
  await expect(page.getByRole('radio', { name: '换色', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(async () => (await latestDraft(page, second.id))?.input.productUse).toBe('colors');
  const restored = (await latestDraft(page, second.id))!.input;
  expect(restored.media.map(media => media.role)).toEqual([second, first, third].flatMap(set => set.media.map(media => media.role)));
  expect(unexpected).toEqual([]);
});

test('选款弹窗跨页面导航自动关闭，返回创作重新选款可继续且旧选择不泄漏', async ({ page }) => {
  await login(page);
  const original = await seedSet(page, 'ROUTE-8001', 1);
  const staged = await seedSet(page, 'ROUTE-8002', 1);
  const unexpected = observeNoAutomaticActions(page);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  let picker = await openPicker(page);
  await select(picker, original.styleNumber); await applyPicker(picker);
  picker = await openPicker(page);
  await select(picker, staged.styleNumber);
  // A hash navigation can originate outside the app controls (for example a saved URL).
  await page.evaluate(() => { location.hash = '#history'; });
  await expect(page.getByRole('heading', { name: '生成记录', exact: true })).toBeVisible();
  await expect(picker).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('list', { name: '本次款号', exact: true }).getByRole('listitem')).toHaveCount(1);
  picker = await openPicker(page);
  await expect(picker.getByRole('button', { name: `选择款号：${original.styleNumber}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('button', { name: `选择款号：${staged.styleNumber}`, exact: true })).toHaveAttribute('aria-pressed', 'false');
  await select(picker, staged.styleNumber); await applyPicker(picker);
  await expect(page.getByRole('list', { name: '本次款号', exact: true }).getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('.creation-product .product-tile img')).toHaveCount(2);
  expect(unexpected).toEqual([]);
});

test('取消多选不改变当前商品，确认不同图套组合才清空旧商品事实与其他要求', async ({ page }) => {
  await login(page);
  const original = await seedSet(page, 'CANCEL-7001', 1);
  const replacement = await seedSet(page, 'CANCEL-7002', 1);
  const skill = await create(page, '/api/skills', { name: '组合替换回归脚本', kind: 'opening', duration: 3, text: '# 开头\n保持当前商品，依照图套顺序展示。', visibility: 'private' });
  await page.reload();
  const unexpected = observeNoAutomaticActions(page);
  let picker = await openPicker(page);
  await select(picker, original.styleNumber); await applyPicker(picker);
  await page.getByRole('button', { name: `选择脚本：${skill.name}`, exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  let settings = page.getByRole('dialog', { name: '生成设置', exact: true });
  await settings.getByText('高级设置', { exact: true }).click();
  await settings.getByRole('textbox', { name: '商品信息', exact: true }).fill('旧款确认面料信息');
  await settings.getByRole('textbox', { name: '其他要求', exact: true }).fill('只属于旧款的特别要求');
  await settings.getByRole('combobox', { name: '发布平台', exact: true }).selectOption('tiktok');
  await settings.getByRole('combobox', { name: '目标市场', exact: true }).selectOption('US');
  await settings.getByRole('button', { name: '返回', exact: true }).click();
  picker = await openPicker(page);
  await select(picker, replacement.styleNumber);
  await picker.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByRole('list', { name: '本次款号', exact: true }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  settings = page.getByRole('dialog', { name: '生成设置', exact: true });
  await settings.getByText('高级设置', { exact: true }).click();
  await expect(settings.getByRole('textbox', { name: '商品信息', exact: true })).toHaveValue('旧款确认面料信息');
  await expect(settings.getByRole('textbox', { name: '其他要求', exact: true })).toHaveValue('只属于旧款的特别要求');
  await settings.getByRole('button', { name: '返回', exact: true }).click();
  picker = await openPicker(page);
  await select(picker, replacement.styleNumber); await applyPicker(picker);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  settings = page.getByRole('dialog', { name: '生成设置', exact: true });
  await settings.getByText('高级设置', { exact: true }).click();
  await expect(settings.getByRole('textbox', { name: '商品信息', exact: true })).toHaveValue('');
  await expect(settings.getByRole('textbox', { name: '其他要求', exact: true })).toHaveValue('');
  await expect(settings.getByRole('combobox', { name: '发布平台', exact: true })).toHaveValue('tiktok');
  await expect(settings.getByRole('combobox', { name: '目标市场', exact: true })).toHaveValue('US');
  expect(unexpected).toEqual([]);
});
