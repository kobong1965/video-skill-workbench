import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { LibTVClient, assertImportCommand } from '../../packages/canvas/cli';
import type { CanvasImportInfo } from '../../packages/canvas/contracts';
import { CanvasImportRunner } from '../../packages/canvas/import-service';

class FakeLibTV {
  calls: string[][] = [];
  nodes: { id: string; name: string; type?: string; x?: number; y?: number; width?: number; height?: number; data: Record<string, unknown> }[] = [];
  edges: { source: string; target: string }[] = [];
  projectId = '0123456789abcdef0123456789abcdef';
  projectName = '';
  failVideoOnce = false;
  trimVideoPrompt = false;
  async execute(args: string[]) {
    assertImportCommand(args);
    this.calls.push(args);
    if (args[0] === '--version') return '1.1.3';
    if (args[0] === 'model') return { schema: { properties: { modeType: { items: { text2video: [0, 0], mixed2video: [1, 12], image2video: [1, 9] } } } } };
    if (args[0] === 'account') return { activeAccount: { accountName: '本地测试账号' } };
    if (args[0] === 'workspace') return { folders: [{ id: 123, name: '测试工作区' }] };
    if (args[0] === 'project' && args[1] === 'list') return { projectMetaList: this.projectName ? [{ uuid: this.projectId, name: this.projectName, folderId: 123 }] : [], total: this.projectName ? 1 : 0 };
    if (args[0] === 'project' && args[1] === 'create') { this.projectName = args[2]; return { projectMeta: { uuid: this.projectId } }; }
    if (args[0] === 'project') return { projectUuid: this.projectId, nodes: this.nodes, edges: this.edges };
    if (args[0] === 'node' && args[1] === 'list') return { nodes: this.nodes.map(x => ({ id: x.id, name: x.name })) };
    if (args[0] === 'group') {
      if (args[1] === 'list') return { groups: this.nodes.filter(x => x.type === 'group') };
      const creating = args[1] === 'create';
      let group = creating ? undefined : this.nodes.find(x => x.id === args[1]);
      if (creating) { group = { id: randomUUID(), name: args[2], type: 'group', data: { childNodeIds: [] } }; this.nodes.push(group); }
      if (!group) throw new Error('找不到模拟分组');
      const children = [...(group.data.childNodeIds as string[])];
      for (let i = 0; i < args.length; i++) if (args[i] === '--node' && !children.includes(args[i + 1])) children.push(args[i + 1]);
      group.data.childNodeIds = children;
      const members = this.nodes.filter(x => children.includes(x.id));
      group.x = Math.min(...members.map(x => x.x!)) - 80; group.y = Math.min(...members.map(x => x.y!)) - 80;
      group.width = Math.max(...members.map(x => x.x! + x.width!)) - group.x + 80;
      group.height = Math.max(...members.map(x => x.y! + x.height!)) - group.y + 80;
      return { groupNodeKey: group.id, boundNodeKeys: children, data: group.data };
    }
    const position = { x: Number(args[args.indexOf('--x') + 1] ?? 0), y: Number(args[args.indexOf('--y') + 1] ?? 0), width: 360, height: 560 };
    if (args[0] === 'upload') { const node = { id: randomUUID(), name: args[1], type: args[args.indexOf('-t') + 1], ...position, data: {} }; this.nodes.push(node); return { nodeKey: node.id }; }
    const create = args.indexOf('create');
    const type = args[args.indexOf('-t') + 1];
    if (type === 'video' && args.includes('--left')) throw new Error('已连接媒体输入，无法使用纯文生视频');
    if (type === 'video' && this.failVideoOnce) { this.failVideoOnce = false; throw new Error('模拟网络中断'); }
    let node;
    if (create >= 0) { node = { id: randomUUID(), name: args[create + 1], type, ...position, data: type === 'video' ? { params: { model: 'Seedance 2.5' } } : {} }; this.nodes.push(node); }
    else node = this.nodes.find(x => x.id === args[1]);
    if (!node) throw new Error('找不到模拟节点');
    const content = args.find(x => x.startsWith('content='));
    if (content) node.data.content = JSON.parse(content.slice('content='.length));
    if (args.includes('--prompt')) {
      const prompt = args[args.indexOf('--prompt') + 1];
      node.data.params = { ...(node.data.params as Record<string, unknown> ?? {}), prompt: this.trimVideoPrompt ? prompt.trim() : prompt };
    }
    for (let i = 0; i < args.length; i++) if (args[i] === '--left' && !this.edges.some(x => x.source === args[i + 1] && x.target === node.id)) this.edges.push({ source: args[i + 1], target: node.id });
    return { nodeKey: node.id, data: node.data };
  }
}

let h: Awaited<ReturnType<typeof harness>>; let a: Awaited<ReturnType<typeof h.account>>; let b: typeof a;
let taskId: string; let resultId: string; let mock: ReturnType<typeof vi.spyOn>; const fake = new FakeLibTV();
beforeAll(async () => {
  mock = vi.spyOn(LibTVClient.prototype, 'execute').mockImplementation(args => fake.execute(args));
  h = await harness('canvas'); a = await h.account('admin'); b = await h.account();
  const media = await saveMedia(h.context, a.id, 'product.png', await sharp({ create: { width: 16, height: 16, channels: 3, background: '#aaa' } }).png().toBuffer());
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '3秒开头', text: '# 开头\n只拍摄三秒', kind: 'opening', duration: 3, visibility: 'private' } })).json();
  const task = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: { name: '画布导入测试', media: [{ id: media.id, role: 'product' }], platform: 'tiktok', market: 'US', category: '服装', targetDuration: 3, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'voiceover', selections: [{ id: skill.id, versionId: skill.versionId, duration: 3 }] } });
  taskId = task.json().id;
  const output = { productFacts: [], unknowns: [], conflicts: [], globalPrompt: '自然光美式英语女声画外音，真实展示商品，保持自然。', shots: [{ skillVersionId: skill.versionId, duration: 3, title: '开头', prompt: '自然光商品近景，保持真实。', dialogue: 'Look at this!', translation: '看看这个！', storyAudio: '柔和器乐和环境风声', startState: '静止', endState: '停留', references: [media.id] }], assetPlan: [] };
  const result = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: a.headers, payload: { output } });
  expect(result.statusCode).toBe(200); resultId = result.json().id;
});
afterAll(async () => { await h.close(); mock.mockRestore(); });
async function waitFor(id: string) {
  let info: CanvasImportInfo | undefined;
  for (let n = 0; n < 200; n++) {
    info = (await h.app.inject({ url: `/api/canvas/imports/${id}`, headers: a.headers })).json();
    if (info && !['queued', 'running'].includes(info.status)) return info;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`导入未结束：${info?.status}`);
}

// Isolate canvas persistence from catalog selection; the API tests cover trusted selection creation.
async function savedCatalogResult() {
  const prior = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json();
  const task = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: prior.snapshot.input })).json();
  const snapshot = structuredClone(prior.snapshot);
  const selectionId = randomUUID();
  const catalog = { selectionId, productUid: randomUUID(), category: 'men', sku: 'SKU-9001', name: '蓝色牛仔裤',
    binding: { shopName: 'DEMOB', market: 'US', productId: '9100000000000001001', productUrl: null, matchStatus: 'image_matched' },
    sourceHash: 'a'.repeat(64), sourceUpdatedAt: '2026-10-31T00:00:00Z', selectedAt: '2026-11-04T01:00:00Z', assets: [] };
  snapshot.input.productGroups = [{ source: 'catalog', catalogSelectionId: selectionId, styleNumber: catalog.sku, name: catalog.name, mediaIds: snapshot.media.map((media: { id: string }) => media.id), catalog }];
  await h.db.query('UPDATE tasks SET snapshot=$2 WHERE id=$1', [task.id, snapshot]);
  const result = await h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/results`, headers: a.headers, payload: { output: prior.results[0].output } });
  expect(result.statusCode).toBe(200);
  const started = await h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/canvas-imports`, headers: a.headers, payload: { resultId: result.json().id, projectId: fake.projectId, key: randomUUID() } });
  expect(started.statusCode).toBe(200);
  return waitFor(started.json().id);
}

describe('LibTV 工作流导入 API（模拟官方 CLI，不写远端）', () => {
  it('商品ID独立写入画布与本地计划，不接入视频且续传不重复创建', async () => {
    const complete = await savedCatalogResult();
    expect(complete.status).toBe('succeeded');
    expect(complete.productBindings?.[0].productId).toBe('9100000000000001001');
    const recordStep = complete.steps.find(step => step.label.includes('商品资料记录'))!;
    expect(recordStep?.nodeKey).toBeDefined();
    const record = fake.nodes.find(node => node.id === recordStep.nodeKey)!;
    expect(record.data.content).toEqual([expect.stringContaining('商品 ID：9100000000000001001')]);
    expect(fake.edges.some(edge => edge.source === record.id)).toBe(false);
    const group = fake.nodes.find(node => node.id === complete.steps.find(step => step.key.startsWith('group:'))?.nodeKey)!;
    expect(group.data.childNodeIds).toContain(record.id);
    const stored = (await h.db.query('SELECT * FROM canvas_imports WHERE id=$1', [complete.id])).rows[0];
    expect(stored.plan.productBindings[0].productId).toBe('9100000000000001001');
    const beforeNodes = fake.nodes.map(node => structuredClone(node));
    await h.db.query("UPDATE canvas_imports SET status='unknown' WHERE id=$1", [complete.id]);
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${complete.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    expect((await waitFor(complete.id)).status).toBe('succeeded');
    expect(fake.nodes).toEqual(beforeNodes);
    expect(fake.calls.flat().some(value => value === '--run' || value === '-r' || value.startsWith('model='))).toBe(false);
    expect((await h.db.query('SELECT count(*) FROM jobs')).rows[0].count).toBe('0');
  });
  it('用户改过商品记录或把它连入视频时停止核验，不覆盖或擅自断开连线', async () => {
    const complete = await savedCatalogResult();
    expect(complete.status).toBe('succeeded');
    const record = fake.nodes.find(node => node.id === complete.steps.find(step => step.label.includes('商品资料记录'))?.nodeKey)!;
    const original = record.data.content;
    record.data.content = ['用户改过的商品记录'];
    await h.db.query("UPDATE canvas_imports SET status='unknown' WHERE id=$1", [complete.id]);
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${complete.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    expect((await waitFor(complete.id)).error).toContain('商品资料记录已修改');
    expect(record.data.content).toEqual(['用户改过的商品记录']);
    record.data.content = original;
    const videoId = complete.steps.find(step => step.key === 'video:1')!.nodeKey!;
    const edge = { source: record.id, target: videoId };
    fake.edges.push(edge);
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${complete.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    expect((await waitFor(complete.id)).error).toContain('商品资料记录被连接');
    expect(fake.edges).toContainEqual(edge);
    fake.edges = fake.edges.filter(item => item !== edge);
  });
  it('归一化当前连接和画布列表，不暴露本机凭据', async () => {
    const connection = (await h.app.inject({ url: '/api/canvas/connection', headers: a.headers })).json();
    expect(connection).toEqual({ available: true, connected: true, version: '1.1.3', accountName: '本地测试账号' });
    const projects = (await h.app.inject({ url: '/api/canvas/projects?workspace=123', headers: a.headers })).json();
    expect(projects.workspaces).toEqual([{ id: '123', name: '测试工作区' }]);
  });
  it('未确认文字也可后台建立工作流，重复提交不新建，所有模型生成请求为零', async () => {
    const key = randomUUID(); const payload = { key, resultId, newProjectName: '新画布' };
    const started = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/canvas-imports`, headers: a.headers, payload });
    expect(started.statusCode).toBe(200); expect(started.json().status).toBe('queued');
    const complete = await waitFor(started.json().id);
    expect(complete.status).toBe('succeeded'); expect(complete.progress).toBe(100);
    expect(complete.projectUrl).toContain(fake.projectId); expect(complete.steps.every(x => x.status === 'succeeded')).toBe(true);
    const count = fake.nodes.length;
    const again = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/canvas-imports`, headers: a.headers, payload });
    expect(again.json().id).toBe(complete.id); expect(fake.nodes).toHaveLength(count);
    expect(fake.calls.flat().some(x => x === '-r' || x === '--run')).toBe(false);
    expect(fake.calls.flat().some(x => x.startsWith('model='))).toBe(false);
    expect((await h.db.query('SELECT count(*) FROM jobs')).rows[0].count).toBe('0');
    const texts = fake.calls.filter(x => x.includes('-u')).flat().join('\n');
    expect(texts).toContain('Look at this!'); expect(texts).toContain('柔和器乐和环境风声');
    expect((await h.app.inject({ url: `/api/tasks/${taskId}/canvas-imports?resultId=${resultId}`, headers: a.headers })).json()).toHaveLength(1);
  });
  it('导入失败后续传已上传素材，不重复创建或覆盖其他节点', async () => {
    fake.failVideoOnce = true;
    const started = (await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/canvas-imports`, headers: a.headers, payload: { key: randomUUID(), resultId, projectId: fake.projectId } })).json();
    const failed = await waitFor(started.id);
    expect(failed.status).toBe('failed'); expect(failed.progress).toBeGreaterThan(0); expect(failed.progress).toBeLessThan(100);
    const uploaded = fake.calls.filter(x => x[0] === 'upload').length;
    const originalIds = fake.nodes.map(x => x.id);
    const resumed = await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${failed.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    expect(resumed.statusCode).toBe(200);
    expect((await waitFor(failed.id)).status).toBe('succeeded');
    expect(fake.calls.filter(x => x[0] === 'upload')).toHaveLength(uploaded);
    for (const id of originalIds) expect(fake.nodes.some(x => x.id === id)).toBe(true);
  });
  it('CLI 回读去掉末尾换行时可建立和续传原工作流，不触发生成', async () => {
    fake.trimVideoPrompt = true;
    try {
      const prior = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json();
      const task = await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: { ...prior.snapshot.input, targetDuration: 5, selections: prior.snapshot.input.selections.map((x: Record<string, unknown>) => ({ ...x, duration: 5 })) } });
      expect(task.statusCode).toBe(200);
      const output = { ...prior.results[0].output, shots: prior.results[0].output.shots.map((x: Record<string, unknown>) => ({ ...x, duration: 5 })) };
      const result = await h.app.inject({ method: 'POST', url: `/api/tasks/${task.json().id}/results`, headers: a.headers, payload: { output } });
      expect(result.statusCode).toBe(200);
      const started = (await h.app.inject({ method: 'POST', url: `/api/tasks/${task.json().id}/canvas-imports`, headers: a.headers, payload: { key: randomUUID(), resultId: result.json().id, projectId: fake.projectId } })).json();
      const row = (await h.db.query('SELECT * FROM canvas_imports WHERE id=$1', [started.id])).rows[0];
      expect(row.plan.batches[0].video.prompt.endsWith('\n')).toBe(true);
      const complete = await waitFor(started.id);
      expect(complete.status).toBe('succeeded');
      const videoStep = complete.steps.find(x => x.key === 'video:1')!;
      const video = fake.nodes.find(x => x.id === videoStep.nodeKey)!;
      expect((video.data.params as { prompt: string }).prompt).toBe(row.plan.batches[0].video.prompt.trim());
      const originalIds = fake.nodes.map(x => x.id);
      const originalEdges = [...fake.edges];
      const uploaded = fake.calls.filter(x => x[0] === 'upload').length;
      // Reproduce the persisted state of an import stopped by the old raw-string guard.
      fake.edges = fake.edges.filter(edge => edge.target !== video.id);
      const interrupted = complete.steps.map(step => ({ ...step, status: step.key === 'video:1' ? 'running' : step.key === 'verify' ? 'pending' : step.status }));
      await h.db.query("UPDATE canvas_imports SET status='failed',steps=$2,error='画布视频提示词已修改' WHERE id=$1", [started.id, JSON.stringify(interrupted)]);
      const resumed = await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${started.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
      expect(resumed.statusCode).toBe(200);
      const recovered = await waitFor(started.id);
      expect(recovered.status).toBe('succeeded');
      expect(recovered.projectId).toBe(fake.projectId);
      expect(recovered.steps.find(x => x.key === 'video:1')?.nodeKey).toBe(video.id);
      expect(fake.nodes.map(x => x.id)).toEqual(originalIds);
      expect(fake.edges).toEqual(originalEdges);
      expect(fake.calls.filter(x => x[0] === 'upload')).toHaveLength(uploaded);
      expect(fake.calls.flat().some(x => x === '-r' || x === '--run')).toBe(false);
      expect((await h.db.query('SELECT count(*) FROM jobs')).rows[0].count).toBe('0');
    } finally { fake.trimVideoPrompt = false; }
  });
  it('拒绝跨账号导入或读取，以及不属于该任务的结果', async () => {
    const post = (headers: typeof a.headers, selectedResult = resultId) => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/canvas-imports`, headers, payload: { key: randomUUID(), resultId: selectedResult } });
    expect((await post(b.headers)).statusCode).toBe(404);
    expect((await post(a.headers, randomUUID())).statusCode).toBe(404);
    const row = (await h.db.query('SELECT id FROM canvas_imports LIMIT 1')).rows[0];
    expect((await h.app.inject({ url: `/api/canvas/imports/${row.id}`, headers: b.headers })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${row.id}/retry`, headers: b.headers, payload: { key: randomUUID() } })).statusCode).toBe(404);
  });
  it('每次导入创建独立分组，避开已有图且续传不重复分组', async () => {
    const before = fake.nodes.map(x => structuredClone(x));
    const started = (await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/canvas-imports`, headers: a.headers, payload: { key: randomUUID(), resultId, projectId: fake.projectId } })).json();
    const complete = await waitFor(started.id);
    expect(complete.status).toBe('succeeded');
    const added = fake.nodes.filter(x => !before.some(old => old.id === x.id));
    const group = added.find(x => x.type === 'group');
    expect(group).toBeDefined();
    const children = added.filter(x => x.type !== 'group');
    expect(new Set(group!.data.childNodeIds as string[])).toEqual(new Set(children.map(x => x.id)));
    const right = Math.max(0, ...before.map(x => (x.x ?? 0) + (x.width ?? 0)));
    expect(children.every(x => x.x! >= right + 300)).toBe(true);
    for (const old of before) expect(fake.nodes.find(x => x.id === old.id)).toEqual(old);
    const ids = fake.nodes.map(x => x.id);
    group!.name = '用户重新命名的脚本组';
    await h.db.query("UPDATE canvas_imports SET status='unknown' WHERE id=$1", [started.id]);
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${started.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    expect((await waitFor(started.id)).status).toBe('succeeded');
    expect(fake.nodes.map(x => x.id)).toEqual(ids);
    expect(group!.name).toBe('用户重新命名的脚本组');
    expect(fake.calls.flat().some(x => x === '--run' || x === '-r')).toBe(false);
  });
  it('重启只标记被中断的导入，不自动重新提交，也保留已完成步骤', async () => {
    const row = (await h.db.query('SELECT * FROM canvas_imports LIMIT 1')).rows[0];
    await h.db.query("UPDATE canvas_imports SET status='running' WHERE id=$1", [row.id]);
    const calls = fake.calls.length;
    const runner = new CanvasImportRunner(h.context, fake);
    await runner.recover();
    const recovered = (await h.app.inject({ url: `/api/canvas/imports/${row.id}`, headers: a.headers })).json();
    expect(recovered.status).toBe('unknown'); expect(recovered.steps).toEqual(row.steps);
    expect(fake.calls).toHaveLength(calls);
  });
  it('公共 Skill 明确要求的原对标会上传并连接，不将预览视频当成对标', async () => {
    await h.db.query("UPDATE users SET role='admin' WHERE id=$1", [b.id]);
    const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: b.headers, payload: { name: '必需原对标', text: '# 开头\n只拍三秒，沿用原对标。', kind: 'opening', duration: 3, visibility: 'public', sharingConfirmed: true } })).json();
    const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
    const benchmark = await saveMedia(h.context, b.id, 'original.mp4', bytes);
    const preview = await saveMedia(h.context, b.id, 'result.mp4', bytes);
    await h.db.query('INSERT INTO skill_files(version_id,path,mime,text) VALUES($1,$2,$3,$4)', [skill.versionId, 'workbench.json', 'application/json', JSON.stringify({ referenceVideoRequired: true, benchmarkVideo: 'benchmark/original.mp4' })]);
    await h.db.query('INSERT INTO skill_files(version_id,path,mime,media_id) VALUES($1,$2,$3,$4),($1,$5,$3,$6)', [skill.versionId, 'benchmark/original.mp4', 'video/mp4', benchmark.id, 'previews/result.mp4', preview.id]);
    const prior = (await h.app.inject({ url: `/api/tasks/${taskId}`, headers: a.headers })).json();
    const task = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: { ...prior.snapshot.input, selections: [{ id: skill.id, versionId: skill.versionId, duration: 3 }] } })).json();
    const output = { ...prior.results[0].output, shots: prior.results[0].output.shots.map((x: Record<string, unknown>) => ({ ...x, skillVersionId: skill.versionId })) };
    const result = (await h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/results`, headers: a.headers, payload: { output } })).json();
    const start = fake.calls.length;
    const imported = await h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/canvas-imports`, headers: a.headers, payload: { resultId: result.id, projectId: fake.projectId, key: randomUUID() } });
    expect(imported.statusCode).toBe(200);
    expect((await waitFor(imported.json().id)).status).toBe('succeeded');
    const uploads = fake.calls.slice(start).filter(x => x[0] === 'upload');
    expect(uploads).toHaveLength(2);
    const video = uploads.find(x => x[x.indexOf('-t') + 1] === 'video');
    expect(video?.[video.indexOf('-f') + 1]).toContain(benchmark.id);
    expect(uploads.flat().join('\n')).not.toContain(preview.id);
    const node = fake.nodes.find(x => x.name === video?.[1]);
    expect(fake.edges.some(edge => edge.source === node?.id)).toBe(true);
    await h.db.query('DELETE FROM skill_files WHERE version_id=$1 AND path=$2', [skill.versionId, 'benchmark/original.mp4']);
    const denied = await h.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/canvas-imports`, headers: a.headers, payload: { resultId: result.id, projectId: fake.projectId, key: randomUUID() } });
    expect(denied.statusCode).toBe(409); expect(denied.json().error).toContain('缺少必需原对标视频');
  });
  it('续传不会改写用户手动改过的文本或已生成的视频节点', async () => {
    const prior = (await h.db.query("SELECT * FROM canvas_imports WHERE task_id=$1 AND status='succeeded' LIMIT 1", [taskId])).rows[0];
    const textStep = prior.steps.find((x: { key: string }) => x.key.startsWith('text:'));
    const videoStep = prior.steps.find((x: { key: string }) => x.key.startsWith('video:'));
    const text = fake.nodes.find(x => x.id === textStep.nodeKey)!;
    const video = fake.nodes.find(x => x.id === videoStep.nodeKey)!;
    video.data.taskInfo = { taskId: 'user-started-task' };
    await h.db.query("UPDATE canvas_imports SET status='unknown' WHERE id=$1", [prior.id]);
    let start = fake.calls.length;
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${prior.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    let status = await waitFor(prior.id);
    expect(status.error).toContain('已有生成任务或结果');
    expect(fake.calls.slice(start).filter(x => x.includes('--prompt'))).toHaveLength(0);
    expect(video.data.taskInfo).toEqual({ taskId: 'user-started-task' });
    delete video.data.taskInfo;
    const params = video.data.params as { prompt: string };
    const originalPrompt = params.prompt;
    params.prompt = '用户改过视频提示词，必须保留';
    start = fake.calls.length;
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${prior.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    status = await waitFor(prior.id);
    expect(status.error).toContain('视频提示词已修改');
    expect(params.prompt).toBe('用户改过视频提示词，必须保留');
    expect(fake.calls.slice(start).some(x => x.includes('-u') || x.includes('--prompt'))).toBe(false);
    params.prompt = originalPrompt;
    text.data.content = ['用户手动改写的文案'];
    start = fake.calls.length;
    await h.app.inject({ method: 'POST', url: `/api/canvas/imports/${prior.id}/retry`, headers: a.headers, payload: { key: randomUUID() } });
    status = await waitFor(prior.id);
    expect(status.error).toContain('提示词已修改');
    expect(text.data.content).toEqual(['用户手动改写的文案']);
    expect(fake.calls.slice(start).some(x => x.includes('-u') || x.includes('--prompt'))).toBe(false);
  });
});
