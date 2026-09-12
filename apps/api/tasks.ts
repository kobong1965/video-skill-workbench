import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { creationSchema, type TaskSnapshot, type PromptOutput } from '../../packages/contracts';
import { planSelection, validateOutput, batchShots, speechWarnings } from '../../packages/domain/planning';
import { ownedMedia } from '../../packages/storage/private-files';
import { transaction } from '../../packages/storage/database';
import { skillDetail } from './skills';
import { taskRow, enqueue, addResult } from './task-service';
import { defaultCapabilities } from './settings';
import { AppError, type Routes } from './context';
import { validateReferences } from '../../packages/domain/references';

export const registerTasks: Routes = async (app, context) => {
  const { db } = context;
  app.post('/api/tasks', async request => {
    const input = creationSchema.parse(request.body);
    if (!input.media.some(x => x.role === 'product')) throw new AppError(400, '请指定至少一张主商品图');
    if (new Set(input.media.map(x => x.id)).size !== input.media.length) throw new AppError(400, '同一图片不能绑定多个角色');
    const media = [];
    for (const item of input.media) {
      const file = await ownedMedia(context, item.id, request.user.id);
      if (!file.mime.startsWith('image/')) throw new AppError(400, '产品参考必须是图片');
      media.push({ id: file.id, role: item.role, name: file.name, mime: file.mime });
    }
    const skills = [];
    for (const selection of input.selections) {
      const detail = await skillDetail(context, request.user, selection.id, selection.versionId);
      skills.push({ id: detail.id, versionId: detail.versionId, name: detail.name, kind: detail.kind, duration: selection.duration, text: detail.text,
        references: detail.files.filter(x => x.text && !/(^|\/)(SKILL\.md|.*original.*|.*history.*)$/i.test(x.path)).map(x => ({ path: x.path, text: x.text! })) });
    }
    try { planSelection(skills, input.targetDuration); } catch (error) { throw new AppError(400, (error as Error).message); }
    if (input.parentId) await taskRow(context, input.parentId, request.user.id);
    const capabilities = (await db.query("SELECT value FROM settings WHERE key='capabilities'")).rows[0]?.value ?? defaultCapabilities;
    const snapshot: TaskSnapshot = { input, skills, media, capability: capabilities[input.model] };
    const id = randomUUID();
    await db.query('INSERT INTO tasks(id,owner_id,name,snapshot,parent_id) VALUES($1,$2,$3,$4,$5)', [id, request.user.id, input.name || input.productName || '新创作', snapshot, input.parentId ?? null]);
    return { id };
  });
  app.get('/api/tasks', async request => (await db.query('SELECT id,name,status,created_at AS "createdAt",parent_id AS "parentId" FROM tasks WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 200', [request.user.id])).rows);
  app.get('/api/tasks/:id', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const task = await taskRow(context, id, request.user.id);
    const results = (await db.query('SELECT id,number,output,confirmed,created_at AS "createdAt" FROM results WHERE task_id=$1 ORDER BY number DESC', [id])).rows;
    const jobs = (await db.query('SELECT id,kind,status,error,attempts,payload FROM jobs WHERE task_id=$1 ORDER BY created_at', [id])).rows;
    const assets = (await db.query('SELECT id,name,kind,media_id AS "mediaId",task_id AS "taskId",result_id AS "resultId",parent_id AS "parentId",confirmed,batch FROM assets WHERE task_id=$1 AND owner_id=$2 ORDER BY created_at', [id, request.user.id])).rows.map(x => ({ ...x, stale: Boolean(results[0] && x.resultId !== results[0].id) }));
    return { id, name: task.name, status: task.status, createdAt: task.created_at, snapshot: task.snapshot, results, jobs, assets };
  });
  app.post('/api/tasks/:id/generate', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ key: z.string().uuid(), costAccepted: z.literal(true) }).parse(request.body);
    await taskRow(context, id, request.user.id);
    return enqueue(context, request.user.id, id, 'text', input.key);
  });
  app.post('/api/tasks/:id/results', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const task = await taskRow(context, id, request.user.id);
    const { output } = z.object({ output: z.unknown() }).parse(request.body);
    let parsed: PromptOutput;
    try {
      parsed = validateOutput(output, task.snapshot.skills, task.snapshot.input.voice, task.snapshot.input.market);
      const frames = (await db.query("SELECT media_id FROM assets WHERE task_id=$1 AND owner_id=$2 AND kind='tailframe'", [id, request.user.id])).rows.map(x => x.media_id as string);
      validateReferences(parsed.shots, [...task.snapshot.media.map(x => x.id), ...frames]);
    } catch (error) { throw new AppError(400, (error as Error).message); }
    return transaction(db, async client => {
      await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [id]);
      if ((await client.query("SELECT id FROM jobs WHERE task_id=$1 AND status IN ('queued','running')", [id])).rowCount) throw new AppError(409, '请等待正在处理的步骤结束后再修改');
      return addResult(client, id, parsed);
    });
  });
  app.post('/api/tasks/:id/confirm', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { resultId, conflictsAccepted } = z.object({ resultId: z.string().uuid(), conflictsAccepted: z.boolean().default(false) }).parse(request.body);
    const task = await taskRow(context, id, request.user.id);
    await transaction(db, async client => {
      await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [id]);
      const latest = (await client.query('SELECT * FROM results WHERE task_id=$1 ORDER BY number DESC LIMIT 1', [id])).rows[0];
      if (!latest || latest.id !== resultId) throw new AppError(409, '结果版本已变化，请刷新后确认最新版本');
      if (latest.output.conflicts.length && !conflictsAccepted) throw new AppError(409, '脚本存在待确认冲突，请处理或明确接受后继续');
      await client.query('UPDATE results SET confirmed=true WHERE id=$1', [resultId]);
      const output = latest.output as PromptOutput;
      const needsImages = task.snapshot.input.generatePerson || task.snapshot.input.generateScene || batchShots(output.shots, task.snapshot.capability).length > 1;
      await client.query('UPDATE tasks SET status=$1 WHERE id=$2', [needsImages ? 'awaiting_assets' : 'completed', id]);
    });
    return { ok: true };
  });
  app.get('/api/tasks/:id/batches', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const task = await taskRow(context, id, request.user.id);
    const result = (await db.query('SELECT * FROM results WHERE task_id=$1 ORDER BY number DESC LIMIT 1', [id])).rows[0];
    if (!result) return { batches: [], warnings: [] };
    try { return { batches: batchShots(result.output.shots, task.snapshot.capability), warnings: speechWarnings(result.output, task.snapshot.input.market), capability: task.snapshot.capability }; }
    catch (error) { throw new AppError(409, (error as Error).message); }
  });
};
