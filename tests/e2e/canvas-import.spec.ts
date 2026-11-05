import { test, expect, type Page } from './fixtures';

async function openPaginationImport(page: Page) {
  const taskId = '44444444-4444-4444-8444-444444444444';
  const resultId = '55555555-5555-4555-8555-555555555555';
  await page.route(`**/api/tasks/${taskId}`, route => route.fulfill({ json: {
    id: taskId, name: '画布分页验证', status: 'awaiting_confirmation', createdAt: new Date().toISOString(), jobs: [], assets: [],
    snapshot: { input: { market: 'US', model: 'seedance-2.5', voice: 'voiceover', generatePerson: false, generateScene: false }, capability: { min: 4, max: 30 }, skills: [], media: [] },
    results: [{ id: resultId, number: 1, confirmed: false, createdAt: new Date().toISOString(), output: { globalPrompt: '严格按商品图展示商品，保持产品一致。', productFacts: [], unknowns: [], conflicts: [], assetPlan: [], shots: [{ title: '商品展示', duration: 12, prompt: '自然光下展示商品。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [] }] } }],
  } }));
  await page.route(`**/api/tasks/${taskId}/assets?**`, route => route.fulfill({ json: { bindings: [], missing: [] } }));
  await page.route('**/api/canvas/connection', route => route.fulfill({ json: { available: true, connected: true, accountName: '测试账号' } }));
  await page.route(`**/api/tasks/${taskId}/canvas-imports**`, route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台' })).toBeVisible();
  await page.goto(`/#task/${taskId}`);
  await page.getByRole('button', { name: '导入画布', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '导入 LibTV 画布' });
  await modal.getByLabel('使用已有画布').check();
  return { modal, taskId, resultId };
}

test('提示词和商品图可导入指定画布，只创建工作流不生成', async ({ page }) => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const resultId = '22222222-2222-4222-8222-222222222222';
  const projectId = '60581fbf922b4ba9b7981186e8f73d21';
  const record = { id: '33333333-3333-4333-8333-333333333333', taskId, resultId, status: 'succeeded', progress: 100, projectId, projectUrl: `https://www.liblib.tv/canvas?projectId=${projectId}`, error: null, steps: [{ key: 'product-1', label: '商品图', status: 'succeeded' }, { key: 'prompt-1', label: '提示词和视频节点', status: 'succeeded' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await page.route(`**/api/tasks/${taskId}`, route => route.fulfill({ json: {
    id: taskId, name: '画布导入验证', status: 'awaiting_confirmation', createdAt: new Date().toISOString(), jobs: [], assets: [],
    snapshot: { input: { market: 'US', model: 'seedance-2.5', voice: 'voiceover', generatePerson: false, generateScene: false }, capability: { min: 4, max: 30 }, skills: [], media: [{ id: 'product-1', name: '商品图.png', mime: 'image/png', role: 'product' }] },
    results: [{ id: resultId, number: 1, confirmed: false, createdAt: new Date().toISOString(), output: { globalPrompt: '严格按商品图展示商品，保持产品一致。', productFacts: [], unknowns: [], conflicts: [], assetPlan: [], shots: [{ title: '商品展示', duration: 12, prompt: '自然光下展示商品。', dialogue: 'Look at this.', translation: '看看这个。', storyAudio: '环境声音', startState: '站立', endState: '停留', references: [] }] } }],
  } }));
  await page.route(`**/api/tasks/${taskId}/assets?**`, route => route.fulfill({ json: { bindings: [], missing: [] } }));
  await page.route('**/api/canvas/connection', route => route.fulfill({ json: { available: true, connected: true, version: '1.1.3', accountName: '测试账号' } }));
  await page.route('**/api/canvas/projects**', route => route.fulfill({ json: { projects: [{ id: projectId, name: '已有测试画布' }], total: 1, workspaces: [] } }));
  let imports = 0;
  await page.route(`**/api/tasks/${taskId}/canvas-imports**`, async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: [] }); return; }
    const body = route.request().postDataJSON();
    expect(body.resultId).toBe(resultId);
    expect(body.projectId).toBe(projectId);
    expect(body.generate).toBeUndefined();
    imports++;
    await route.fulfill({ json: record });
  });
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作工作台' })).toBeVisible();
  await page.goto(`/#task/${taskId}`);
  await page.getByRole('button', { name: '导入画布', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '导入 LibTV 画布' });
  await expect(modal).toContainText('不自动生成');
  await modal.getByLabel('使用已有画布').check();
  await modal.getByLabel('目标画布', { exact: true }).selectOption(projectId);
  await modal.getByRole('button', { name: '创建工作流', exact: true }).click();
  await expect(modal.getByRole('link', { name: '打开画布', exact: true })).toHaveAttribute('href', record.projectUrl);
  expect(imports).toBe(1);
});

test('已有画布超过50个时可加载下一页，导入到第51个指定画布', async ({ page }) => {
  const projectId = 'pagination-canvas-00000051';
  const requests: number[] = [];
  await page.route('**/api/canvas/projects**', async route => {
    const query = new URL(route.request().url()).searchParams;
    const index = Number(query.get('page') || 1);
    requests.push(index);
    expect(Number(query.get('pageSize') || 50)).toBe(50);
    await route.fulfill({ json: { projects: index === 1
      ? Array.from({ length: 50 }, (_, number) => ({ id: `pagination-canvas-${String(number + 1).padStart(8, '0')}`, name: `分页画布 ${number + 1}` }))
      : [{ id: 'pagination-canvas-00000050', name: '分页画布 50' }, { id: projectId, name: '分页画布 51' }], total: 51, workspaces: [] } });
  });
  const { modal, taskId, resultId } = await openPaginationImport(page);
  const target = modal.getByLabel('目标画布', { exact: true });
  await expect(target.locator('option')).toHaveCount(51);
  await modal.getByRole('button', { name: '加载更多画布', exact: true }).click();
  await expect(target.locator('option')).toHaveCount(52);
  await expect(target.locator(`option[value="${projectId}"]`)).toHaveText('分页画布 51');
  await expect(modal.getByRole('button', { name: '加载更多画布', exact: true })).toHaveCount(0);
  await target.selectOption(projectId);
  let submitted = false;
  await page.route(`**/api/tasks/${taskId}/canvas-imports`, async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toMatchObject({ resultId, projectId });
    expect(route.request().postDataJSON().generate).toBeUndefined();
    submitted = true;
    const now = new Date().toISOString();
    await route.fulfill({ json: { id: '66666666-6666-4666-8666-666666666666', taskId, resultId, status: 'succeeded', progress: 100, projectId, projectUrl: `https://www.liblib.tv/canvas?projectId=${projectId}`, error: null, steps: [], createdAt: now, updatedAt: now } });
  });
  await modal.getByRole('button', { name: '创建工作流', exact: true }).click();
  await expect(modal.getByRole('heading', { name: '工作流已建立', exact: true })).toBeVisible();
  expect(submitted).toBe(true); expect(requests).toEqual([1, 2]);
});

test('切换空间后清空旧页和选择，迟到的旧空间响应不污染新空间', async ({ page }) => {
  let releaseOld!: () => void;
  const oldResponse = new Promise<void>(resolve => { releaseOld = resolve; });
  const workspaces = [{ id: '101', name: '空间 A' }, { id: '102', name: '空间 B' }];
  let requestedOld!: () => void;
  const oldRequested = new Promise<void>(resolve => { requestedOld = resolve; });
  await page.route('**/api/canvas/projects**', async route => {
    const query = new URL(route.request().url()).searchParams;
    const workspace = query.get('workspace');
    if (workspace === '101') { requestedOld(); await oldResponse; }
    await route.fulfill({ json: { projects: [{ id: `workspace-${workspace || 'all'}-canvas`, name: workspace === '102' ? '空间 B 的画布' : workspace === '101' ? '迟到的空间 A 画布' : '全部空间的画布' }], total: 1, workspaces } });
  });
  try {
    const { modal } = await openPaginationImport(page);
    const target = modal.getByLabel('目标画布', { exact: true });
    await target.selectOption('workspace-all-canvas');
    const workspace = modal.getByLabel('项目空间', { exact: true });
    await workspace.selectOption('101');
    await oldRequested;
    await expect(target).toHaveValue('');
    await expect(target.locator('option[value="workspace-all-canvas"]')).toHaveCount(0);
    await workspace.selectOption('102');
    await expect(target.locator('option[value="workspace-102-canvas"]')).toHaveText('空间 B 的画布');
    const oldReceived = page.waitForResponse(response => response.url().includes('/api/canvas/projects?') && new URL(response.url()).searchParams.get('workspace') === '101');
    releaseOld();
    await oldReceived;
    await expect(target.locator('option[value="workspace-101-canvas"]')).toHaveCount(0);
    await expect(target.locator('option[value="workspace-102-canvas"]')).toHaveText('空间 B 的画布');
    await expect(modal.getByRole('button', { name: '创建工作流', exact: true })).toBeDisabled();
  } finally { releaseOld(); }
});
