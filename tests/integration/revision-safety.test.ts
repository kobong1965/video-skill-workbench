import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
import { harness } from '../helpers';
import { saveMedia } from '../../packages/storage/private-files';
import { boundAssets } from '../../apps/api/asset-service';
import { claimJob, runJob } from '../../apps/worker/queue';
import { ProviderError } from '../../packages/providers/network';

let h: Awaited<ReturnType<typeof harness>>; let a: Awaited<ReturnType<typeof h.account>>; let taskId: string; let resultId: string; let imageId: string; let output: unknown;
beforeAll(async () => {
  h = await harness('revision_guard'); a = await h.account('admin');
  imageId = (await saveMedia(h.context, a.id, 'product.png', await sharp({ create: { width: 20, height: 20, channels: 3, background: '#999' } }).png().toBuffer())).id;
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '角度测试', kind: 'full', duration: 10, text: '# 十秒脚本' } })).json();
  taskId = (await h.app.inject({ method: 'POST', url: '/api/tasks', headers: a.headers, payload: { name: '版本安全', media: [{ id: imageId, role: 'product' }], platform: 'douyin', market: 'CN', category: '服装', targetDuration: 10, model: 'seedance-2.5', generatePerson: true, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 10 }] } })).json().id;
  output = { productFacts: [], unknowns: [], conflicts: [], globalPrompt: '自然阳光下的商品展示，当前产品为唯一外观依据。', shots: [{ skillVersionId: skill.versionId, duration: 10, title: '展示', prompt: '自然阳光下展示商品。', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [imageId] }], assetPlan: [] };
  resultId = (await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: a.headers, payload: { output } })).json().id;
  await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm`, headers: a.headers, payload: { resultId } });
  await h.app.inject({ method: 'PUT', url: '/api/admin/providers/image', headers: a.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test', apiKey: 'not-live', references: true, multiReference: true } });
  await h.app.inject({ method: 'PUT', url: `/api/admin/quotas/${a.id}`, headers: a.headers, payload: { text: 20, image: 20 } });
});
afterAll(async () => h.close());

it('多个人物角度不会在引用或导出时只剩最后一张', async () => {
  const master = randomUUID();
  await h.db.query("INSERT INTO assets(id,owner_id,name,kind,media_id,confirmed) VALUES($1,$2,'主图','person',$3,true)", [master, a.id, imageId]);
  await h.db.query("INSERT INTO asset_bindings(id,task_id,result_id,asset_id,kind) VALUES($1,$2,$3,$4,'person')", [randomUUID(), taskId, resultId, master]);
  for (const name of ['左侧', '右侧']) { const id = randomUUID(); await h.db.query("INSERT INTO assets(id,owner_id,name,kind,media_id,parent_id,confirmed) VALUES($1,$2,$3,'angle',$4,$5,true)", [id, a.id, name, imageId, master]); await h.db.query("INSERT INTO asset_bindings(id,task_id,result_id,asset_id,kind) VALUES($1,$2,$3,$4,'angle')", [randomUUID(), taskId, resultId, id]); }
  expect((await boundAssets(h.context, taskId, resultId)).filter(x => x.kind === 'angle')).toHaveLength(2);
});

it('同一图片步骤双击生成，不同请求标识也不重复预留和计费', async () => {
  const submit = () => h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/images`, headers: a.headers, payload: { resultId, kind: 'person', name: '新主图', prompt: '年轻成年人物自然站立展示当前商品', key: randomUUID(), costAccepted: true } });
  const responses = await Promise.all([submit(), submit()]);
  expect(responses.map(x => x.statusCode).sort()).toEqual([200, 409]);
  // Drain every queued fixture request so the next regression is independent of the outcome above.
});

it('编辑脚本后，不能重试引用旧版的失败图片任务', async () => {
  let job = await claimJob(h.context); const ids: string[] = [];
  while (job) { ids.push(job.id); await runJob(h.context, job, { image: async () => { throw new ProviderError('rejected', '测试接口拒绝'); } }); job = await claimJob(h.context); }
  const saved = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/results`, headers: a.headers, payload: { output } }); expect(saved.statusCode).toBe(200);
  const retry = await h.app.inject({ method: 'POST', url: `/api/jobs/${ids[0]}/retry`, headers: a.headers, payload: { costAccepted: true } });
  expect(retry.statusCode).toBe(409); expect(retry.json().error).toContain('版本');
});

it('修改正文保留嵌套附件，不能错误标成缺失，也不能保留旧版正文', async () => {
  const zip = await saveMedia(h.context, a.id, 'nested.zip', Buffer.from(zipSync({ 'bundle/SKILL.md': strToU8('# 原始\n[提示模板](references/prompt.md)'), 'bundle/references/prompt.md': strToU8('固定模板正文') })));
  const original = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: a.headers, payload: { name: '嵌套脚本', kind: 'full', duration: 17, mediaId: zip.id } })).json();
  const edited = (await h.app.inject({ method: 'POST', url: `/api/skills/${original.id}/versions`, headers: a.headers, payload: { text: '# 新正文\n[提示模板](references/prompt.md)', kind: 'full', duration: 17 } })).json();
  expect(edited.missing).toEqual([]); expect(edited.files.find((f: { path: string }) => f.path === 'bundle/SKILL.md').text).toContain('新正文');
});
