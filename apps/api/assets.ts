import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type Routes } from './context';
import { taskRow, enqueue, addResult, assertImageRevision } from './task-service';
import { boundAssets, confirmedResult, missingAssets } from './asset-service';
import { ownedMedia } from '../../packages/storage/private-files';
import { batchShots } from '../../packages/domain/planning';
import { transaction } from '../../packages/storage/database';
import type { PromptOutput } from '../../packages/contracts';

export const registerAssets: Routes = async (app, context) => {
  const { db } = context;
  app.get('/api/assets', async request => (await db.query('SELECT id,name,kind,media_id AS "mediaId",task_id AS "taskId",result_id AS "resultId",parent_id AS "parentId",confirmed,batch FROM assets WHERE owner_id=$1 ORDER BY created_at DESC', [request.user.id])).rows);
  app.post('/api/assets', async request => {
    const input = z.object({ name: z.string().min(1).max(100), kind: z.enum(['person', 'scene', 'angle', 'storyboard']), mediaId: z.string().uuid() }).parse(request.body);
    const media = await ownedMedia(context, input.mediaId, request.user.id);
    if (!media.mime.startsWith('image/')) throw new AppError(400, '参考素材必须是图片');
    const id = randomUUID();
    await db.query('INSERT INTO assets(id,owner_id,name,kind,media_id) VALUES($1,$2,$3,$4,$5)', [id, request.user.id, input.name, input.kind, input.mediaId]);
    return { id };
  });
  app.post('/api/assets/:id/confirm', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await transaction(db, async client => {
      const asset = (await client.query('SELECT * FROM assets WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, request.user.id])).rows[0];
      if (!asset) throw new AppError(404, '参考图不存在');
      await client.query('UPDATE assets SET confirmed=true WHERE id=$1', [id]);
      if (asset.task_id && asset.result_id) {
        const exists = (await client.query('SELECT id FROM asset_bindings WHERE asset_id=$1 AND result_id=$2', [id, asset.result_id])).rowCount;
        if (!exists) await client.query('INSERT INTO asset_bindings(id,task_id,result_id,asset_id,kind,batch) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), asset.task_id, asset.result_id, id, asset.kind, asset.batch]);
        await client.query("UPDATE tasks SET status='awaiting_assets' WHERE id=$1", [asset.task_id]);
      }
    });
    return { ok: true };
  });
  app.get('/api/tasks/:id/assets', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { resultId } = z.object({ resultId: z.string().uuid() }).parse(request.query);
    const task = await taskRow(context, id, request.user.id);
    const result = (await db.query('SELECT output FROM results WHERE id=$1 AND task_id=$2', [resultId, id])).rows[0];
    if (!result) throw new AppError(404, '结果不存在');
    const bindings = await boundAssets(context, id, resultId);
    return { bindings, missing: missingAssets(task.snapshot, result.output, bindings) };
  });
  app.post('/api/tasks/:id/assets', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ resultId: z.string().uuid(), assetId: z.string().uuid(), batch: z.number().int().positive().optional(), referencesConfirmed: z.boolean().default(false) }).parse(request.body);
    const task = await taskRow(context, id, request.user.id); const result = await confirmedResult(context, id, input.resultId);
    const asset = (await db.query('SELECT * FROM assets WHERE id=$1 AND owner_id=$2 AND confirmed=true', [input.assetId, request.user.id])).rows[0];
    if (!asset) throw new AppError(404, '请先选择自己的已确认参考图');
    if (asset.kind !== 'storyboard' && input.batch !== undefined) throw new AppError(400, '人物、角度和场景是全局参考，不能只绑定某一批');
    if (asset.kind === 'storyboard' && (!input.batch || input.batch > batchShots(result.output.shots, task.snapshot.capability).length)) throw new AppError(400, '请选择该面板对应的批次');
    await transaction(db, async client => {
      await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [id]);
      await assertImageRevision(client, id, input);
      const current = await boundAssets(context, id, input.resultId, client);
      const masters = current.filter(x => ['person', 'scene'].includes(x.kind) && !x.stale);
      if (['storyboard', 'angle'].includes(asset.kind) && !input.referencesConfirmed) throw new AppError(409, '请确认所选图片与当前人物和场景参考一致');
      const parent = asset.kind === 'angle' ? masters.find(x => x.kind === 'person')?.id : null;
      if (asset.kind === 'angle' && !parent) throw new AppError(409, '请先绑定已确认的人物主参考');
      if (asset.kind === 'storyboard' && missingAssets(task.snapshot, result.output, current).some(x => !x.includes('故事面板'))) throw new AppError(409, '请先准备当前人物与场景主参考');
      await client.query('INSERT INTO asset_bindings(id,task_id,result_id,asset_id,kind,batch,dependencies,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, input.resultId, input.assetId, asset.kind, input.batch ?? null, JSON.stringify(['storyboard', 'angle'].includes(asset.kind) ? masters.map(x => x.id) : []), parent]);
    });
    return { ok: true };
  });
  app.post('/api/tasks/:id/images', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ resultId: z.string().uuid(), kind: z.enum(['person', 'scene', 'angle', 'storyboard']), name: z.string().min(1).max(100), prompt: z.string().min(5).max(10000), key: z.string().uuid(), costAccepted: context.singleUserMode ? z.boolean().optional() : z.literal(true), parentId: z.string().uuid().optional(), batch: z.number().int().positive().optional() }).parse(request.body);
    const task = await taskRow(context, id, request.user.id); const result = await confirmedResult(context, id, input.resultId);
    const existing = await boundAssets(context, id, input.resultId);
    if (input.kind !== 'storyboard' && input.batch !== undefined) throw new AppError(400, '人物、角度和场景是全局参考，不能只生成某一批');
    if (['person', 'angle'].includes(input.kind) && !task.snapshot.input.generatePerson) throw new AppError(409, '本任务未选择制作人物参考；请另存任务并调整设置');
    if (input.kind === 'scene' && !task.snapshot.input.generateScene) throw new AppError(409, '本任务未选择制作场景参考');
    const refs = input.kind === 'scene' ? [] : task.snapshot.media.filter(m => m.role !== 'comparison').map(x => x.id);
    const referenceAssetIds: string[] = [];
    if (input.kind === 'angle') {
      if (!input.parentId) throw new AppError(409, '请先确认人物主参考，再选择要派生的主图');
      const parent = (await db.query("SELECT * FROM assets WHERE id=$1 AND owner_id=$2 AND confirmed=true AND kind='person'", [input.parentId, request.user.id])).rows[0];
      if (!parent) throw new AppError(409, '人物主参考尚未确认或不可用');
      refs.push(parent.media_id); referenceAssetIds.push(parent.id);
    }
    let prompt = input.prompt;
    if (input.kind === 'storyboard') {
      const batches = batchShots(result.output.shots, task.snapshot.capability);
      const batch = batches.find(x => x.number === input.batch);
      if (!batch) throw new AppError(400, '请选择有效批次');
      const missing = missingAssets(task.snapshot, result.output, existing).filter(x => !x.includes('故事面板'));
      if (missing.length) throw new AppError(409, `请先准备：${missing.join('、')}`);
      for (const asset of existing.filter(x => ['person', 'scene'].includes(x.kind) && !x.stale)) { refs.push(asset.mediaId); referenceAssetIds.push(asset.id); }
      prompt += `\n这是第 ${batch.number} 批的故事面板参考图，不是实际视频尾帧。产品、人物与场景分别按输入参考保持一致。\n${result.output.globalPrompt}\n${batch.shots.map((s, i) => `第${i + 1}格：${s.prompt}`).join('\n')}`;
    }
    const uniqueRefs = [...new Set(refs)];
    return enqueue(context, request.user.id, id, 'image', input.key, { ...input, prompt, referenceMediaIds: uniqueRefs, referenceAssetIds });
  });
  app.post('/api/tasks/:id/continuation', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ resultId: z.string().uuid(), mediaId: z.string().uuid(), nextBatch: z.number().int().min(2), actualFrameConfirmed: z.literal(true) }).parse(request.body);
    const task = await taskRow(context, id, request.user.id); const result = await confirmedResult(context, id, input.resultId);
    const media = await ownedMedia(context, input.mediaId, request.user.id);
    if (!media.mime.startsWith('image/')) throw new AppError(400, '尾帧必须是图片');
    const batches = batchShots(result.output.shots, task.snapshot.capability);
    const target = batches.find(x => x.number === input.nextBatch);
    if (!target) throw new AppError(400, '后续批次不存在');
    const output = structuredClone(result.output) as PromptOutput;
    const index = batches.filter(x => x.number < input.nextBatch).reduce((sum, x) => sum + x.shots.length, 0);
    output.shots[index].prompt += `\n本批开场参考用户上传的上一批真实尾帧（素材 ${input.mediaId}），衔接人物朝向、道具位置和光线，不把规划图当实际尾帧。`;
    output.shots[index].references.push(input.mediaId);
    return transaction(db, async client => {
      await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [id]);
      await assertImageRevision(client, id, input);
      if ((await client.query("SELECT id FROM jobs WHERE task_id=$1 AND status IN ('queued','running')", [id])).rowCount) throw new AppError(409, '请等待正在处理的步骤结束后再修改衔接');
      const revision = await addResult(client, id, output);
      const assetId = randomUUID();
      await client.query("INSERT INTO assets(id,owner_id,name,kind,media_id,task_id,result_id,confirmed,batch) VALUES($1,$2,$3,'tailframe',$4,$5,$6,true,$7)", [assetId, request.user.id, `第 ${input.nextBatch} 批衔接尾帧`, input.mediaId, id, revision.id, input.nextBatch]);
      const old = await boundAssets(context, id, result.id, client);
      for (const asset of old.filter(x => !(x.kind === 'storyboard' && x.batch === input.nextBatch) && !(x.kind === 'tailframe' && x.batch === input.nextBatch))) await client.query('INSERT INTO asset_bindings(id,task_id,result_id,asset_id,kind,batch,dependencies,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, revision.id, asset.id, asset.kind, asset.batch, JSON.stringify(asset.dependencies), asset.parentId]);
      await client.query("INSERT INTO asset_bindings(id,task_id,result_id,asset_id,kind,batch) VALUES($1,$2,$3,$4,'tailframe',$5)", [randomUUID(), id, revision.id, assetId, input.nextBatch]);
      return revision;
    });
  });
};
