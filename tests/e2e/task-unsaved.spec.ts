import { test, expect, type Page } from './fixtures';

const firstId = '81818181-8181-4181-8181-818181818181';
const secondId = '82828282-8282-4282-8282-828282828282';
const revisions = ['83838383-8383-4383-8383-838383838383', '84848484-8484-4484-8484-848484848484'];

async function openTask(page: Page) {
  const ids = [firstId, secondId];
  const names = ['离开保护第一件商品', '离开保护第二件商品'];
  await page.route('**/api/task-board', route => route.fulfill({ json: ids.map((id, index) => ({
    id, name: names[index], status: 'awaiting_confirmation', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    thumbnailMediaId: null, latestResultId: revisions[index], activeJobs: 0, latestJob: null,
    progress: { stage: 'ready', label: '提示词已生成', value: 100 },
  })) }));
  for (const [index, id] of ids.entries()) {
    await page.route(`**/api/tasks/${id}`, route => route.fulfill({ json: {
      id, name: names[index], status: 'awaiting_confirmation', createdAt: new Date().toISOString(), jobs: [], assets: [],
      snapshot: { input: { market: 'CN', model: 'seedance-2.5', voice: 'none', generatePerson: false, generateScene: false }, capability: { min: 4, max: 30 }, skills: [], media: [] },
      results: [{ id: revisions[index], number: 2, confirmed: false, createdAt: new Date().toISOString(), output: {
        globalPrompt: `已保存的第${index + 1}件商品提示词。`, productFacts: [], unknowns: [], conflicts: [], assetPlan: [],
        shots: [{ skillVersionId: 'fixture-skill-version', title: '商品展示', duration: 12, prompt: '自然光下展示商品。', dialogue: 'Look at this.', translation: '看看这个。', storyAudio: '环境声音', startState: '站立', endState: '停留', references: ['product-one'] }],
      } }, { id: `85858585-8585-4585-8585-85858585858${index}`, number: 1, confirmed: false, createdAt: new Date().toISOString(), output: {
        globalPrompt: `历史的第${index + 1}件商品提示词。`, productFacts: [], unknowns: [], conflicts: [], assetPlan: [],
        shots: [{ skillVersionId: 'fixture-skill-version', title: '旧版商品展示', duration: 12, prompt: '旧版展示动作。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [] }],
      } }],
    } }));
    await page.route(`**/api/tasks/${id}/assets?**`, route => route.fulfill({ json: { bindings: [], missing: [] } }));
  }
  await page.goto('/');
  await page.getByLabel('登录账号').fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('button', { name: `查看任务：${names[0]}`, exact: true }).click();
}

async function editedTask(page: Page) {
  await openTask(page);
  const prompt = page.getByRole('textbox', { name: '完整提示词', exact: true });
  await expect(prompt).toHaveValue(/已保存的第1件商品提示词。/);
  await prompt.fill((await prompt.inputValue()).replace('已保存的第1件商品提示词。', '尚未保存的新商品展示要求。'));
  return page.getByRole('dialog', { name: '未保存的修改', exact: true });
}

test('全部提示词只在一个编辑板显示，取消脚本确认和参考图导出大块', async ({ page }) => {
  await openTask(page);
  const editor = page.getByRole('region', { name: '提示词编辑', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox')).toHaveCount(1);
  const prompt = editor.getByRole('textbox', { name: '完整提示词', exact: true });
  for (const content of ['已保存的第1件商品提示词。', '商品展示', '12', '自然光下展示商品。', 'Look at this.', '看看这个。', '环境声音', '站立', '停留']) {
    await expect(prompt).toHaveValue(new RegExp(content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  await expect(page.getByRole('heading', { name: '先看脚本，满意再继续', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认这版脚本', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '参考图准备', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '复制与导出', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '复制整段提示词', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeEnabled();
});

test('结果页不放任务栏，侧栏离开确认可取消且保留原任务及全部修改', async ({ page }) => {
  const confirm = await editedTask(page);
  await expect(page.getByRole('complementary', { name: '任务栏' })).toHaveCount(0);
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#task/${firstId}$`));
  await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('完整提示词', { exact: true })).toHaveValue(/尚未保存的新商品展示要求。/);
  await page.getByRole('link', { name: '脚本库', exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#task/${firstId}$`));
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByLabel('完整提示词', { exact: true })).toHaveValue(/尚未保存的新商品展示要求。/);
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await confirm.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await page.getByRole('button', { name: '查看任务：离开保护第二件商品', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#task/${secondId}$`));
  await expect(page.getByLabel('完整提示词', { exact: true })).toHaveValue(/已保存的第2件商品提示词。/);
});

test('另存新创作先确认未保存修改，取消不重置，继续才打开创作', async ({ page }) => {
  const confirm = await editedTask(page);
  await page.getByRole('button', { name: '另存新创作', exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#task/${firstId}$`));
  await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('完整提示词', { exact: true })).toHaveValue(/尚未保存的新商品展示要求。/);
  await page.getByRole('button', { name: '另存新创作', exact: true }).click();
  await confirm.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await expect(page).toHaveURL(/#create$/);
  await expect(page.getByRole('button', { name: /^上传商品图/ })).toBeVisible();
  await expect(page.getByLabel('图片 1 用途')).toHaveCount(0);
});

test('撤销未保存修改后可直接切换任务', async ({ page }) => {
  const confirm = await editedTask(page);
  await page.getByRole('button', { name: '撤销未保存修改', exact: true }).click();
  await page.getByRole('link', { name: '创作工作台', exact: true }).click();
  await page.getByRole('button', { name: '查看任务：离开保护第二件商品', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#task/${secondId}$`));
  await expect(confirm).toHaveCount(0);
  await expect(page.getByLabel('完整提示词', { exact: true })).toHaveValue(/已保存的第2件商品提示词。/);
});

test('未保存时禁止导入，切换保存版本可取消且不丢失全文', async ({ page }) => {
  const confirm = await editedTask(page);
  const prompt = page.getByRole('textbox', { name: '完整提示词', exact: true });
  const draft = await prompt.inputValue();
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeDisabled();
  const version = page.getByLabel('查看保存版本');
  await version.selectOption('85858585-8585-4585-8585-858585858580');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(version).toHaveValue(revisions[0]);
  await expect(prompt).toHaveValue(draft);
  await version.selectOption('85858585-8585-4585-8585-858585858580');
  await confirm.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await expect(prompt).toHaveValue(/历史的第1件商品提示词。/);
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeEnabled();
});

test('单板编辑保存完整结构为新版本，不自动确认脚本或调用生成', async ({ page }) => {
  await editedTask(page);
  const task = await page.evaluate(async id => (await fetch(`/api/tasks/${id}`)).json(), firstId);
  const original = structuredClone(task.results[0].output);
  let savedOutput: unknown;
  let generationRequests = 0;
  await page.route(`**/api/tasks/${firstId}/results`, async route => {
    expect(route.request().method()).toBe('POST');
    savedOutput = route.request().postDataJSON().output;
    task.results.unshift({ ...task.results[0], id: '86868686-8686-4686-8686-868686868686', number: 3, output: savedOutput });
    await route.fulfill({ json: { id: task.results[0].id } });
  });
  await page.route(`**/api/tasks/${firstId}`, route => route.fulfill({ json: task }));
  await page.route(/\/api\/(?:tasks\/[^/]+\/(?:generate|confirm)|jobs\/[^/]+\/retry)/, route => {
    generationRequests++;
    return route.fulfill({ status: 400, json: { error: '保存编辑不应调用生成或脚本确认' } });
  });
  await page.getByRole('button', { name: '保存修改为新版本', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '修改已保存为新版本' })).toBeVisible();
  expect(savedOutput).toEqual({ ...original, globalPrompt: '尚未保存的新商品展示要求。' });
  expect(generationRequests).toBe(0);
  await expect(page.getByRole('button', { name: '保存修改为新版本', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeEnabled();
});

test('刷新出现新保存版本时仍保留当前未保存全文及原版本', async ({ page }) => {
  await editedTask(page);
  const prompt = page.getByRole('textbox', { name: '完整提示词', exact: true });
  const draft = await prompt.inputValue();
  const task = await page.evaluate(async id => (await fetch(`/api/tasks/${id}`)).json(), firstId);
  task.results.unshift({ ...task.results[0], id: '87878787-8787-4787-8787-878787878787', number: 3, output: { ...task.results[0].output, globalPrompt: '后台新完成的第三版商品提示词。' } });
  await page.route(`**/api/tasks/${firstId}`, route => route.fulfill({ json: task }));
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${firstId}`);
  await page.getByRole('button', { name: '刷新进度', exact: true }).click();
  await refreshed;
  await expect(page.getByLabel('查看保存版本').locator('option')).toHaveCount(3);
  await expect(prompt).toHaveValue(draft);
  await expect(page.getByLabel('查看保存版本')).toHaveValue(revisions[0]);
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeDisabled();
});

test('保存后回读失败仍保留未保存全文，不假称完成或开放导入', async ({ page }) => {
  await editedTask(page);
  const prompt = page.getByRole('textbox', { name: '完整提示词', exact: true });
  const draft = await prompt.inputValue();
  // Record even brief success toasts: waiting for their disappearance would
  // otherwise allow a swallowed GET error to look like a successful save.
  await page.evaluate(() => {
    const observed: string[] = [];
    (window as Window & { observedSaveNotices?: string[] }).observedSaveNotices = observed;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[role="status"]')) observed.push(node.textContent || '');
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.route(`**/api/tasks/${firstId}/results`, route => route.fulfill({ json: { id: '88888888-8888-4888-8888-888888888888' } }));
  await page.route(`**/api/tasks/${firstId}`, route => route.fulfill({ status: 503, json: { error: '测试：回读新版本失败' } }));
  await page.getByRole('button', { name: '保存修改为新版本', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '测试：回读新版本失败' })).toBeVisible();
  await expect(prompt).toHaveValue(draft);
  await expect(page.getByRole('button', { name: '撤销未保存修改', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入画布', exact: true })).toBeDisabled();
  const notices = await page.evaluate(() => (window as Window & { observedSaveNotices?: string[] }).observedSaveNotices || []);
  expect(notices.join('\n')).not.toContain('修改已保存为新版本');
});
