import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { creationSchema, type TaskSnapshot, type PromptOutput, type TaskSummary, type TaskJobSummary } from '../../packages/contracts';
import { planSelection, validateOutput, batchShots, speechWarnings } from '../../packages/domain/planning';
import { ownedMedia } from '../../packages/storage/private-files';
import { transaction } from '../../packages/storage/database';
import { skillDetail } from './skills';
import { taskRow, enqueue, addResult } from './task-service';
import { defaultCapabilities } from './settings';
import { AppError, type Routes } from './context';
import { validateReferences } from '../../packages/domain/references';
import { taskProgress } from '../../packages/domain/task-progress';
import { normalizeTaskProductGroups } from './product-sets';
import { validateProductGroupReferences } from '../../packages/domain/product-groups';
import { freezeSkillPreview, taskSkillPreviews } from './task-previews';
import { providerSummary, type ProviderConfig } from '../../packages/providers/config';
import { taskCanvasStatus, type TaskCanvasImport } from '../../packages/domain/task-canvas-status';

type SummaryJob = Omit<TaskJobSummary, 'progress'> & { payload: Record<string, unknown>; updatedAt: string; frozenProvider: ProviderConfig };
function latestTimestamp(values: unknown[]): string {
  const times = values.map(value => value instanceof Date ? value.getTime() : value ? new Date(String(value)).getTime() : NaN).filter(Number.isFinite);
  return new Date(Math.max(...times)).toISOString();
}

export const registerTasks: Routes = async (app, context) => {
  const { db } = context;
  async function summaries(ownerId: string, limit: number): Promise<TaskSummary[]> {
    const rows = (await db.query(`
      SELECT t.id,t.name,t.status,t.created_at AS "createdAt",t.parent_id AS "parentId",
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',item->>'id','versionId',item->>'versionId',
          'name',item->>'name','preview',item->'preview') ORDER BY position), '[]'::jsonb)
          FROM jsonb_array_elements(t.snapshot->'skills') WITH ORDINALITY AS selected(item,position)) AS "previewSkills",
        (SELECT item->>'id' FROM jsonb_array_elements(t.snapshot->'media') item WHERE item->>'role'='product' LIMIT 1) AS "thumbnailMediaId",
        r.id AS "latestResultId",r.created_at AS "resultCreatedAt",
        (SELECT count(*)::integer FROM jobs j WHERE j.task_id=t.id AND j.status IN ('queued','running')) AS "activeJobs",
        CASE WHEN current_job.id IS NOT NULL THEN jsonb_build_object(
          'id',current_job.id,'kind',current_job.kind,'status',current_job.status,'error',current_job.error,
          'attempts',current_job.attempts,'payload',current_job.payload,'createdAt',current_job.created_at,
          'sentAt',current_job.sent_at,'finishedAt',current_job.finished_at,'updatedAt',current_job.updated_at,'frozenProvider',current_job.provider
        ) ELSE NULL END AS job
      FROM (SELECT * FROM tasks WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2) t
      LEFT JOIN LATERAL (SELECT id,created_at FROM results WHERE task_id=t.id ORDER BY number DESC LIMIT 1) r ON true
      LEFT JOIN LATERAL (
        SELECT j.*,a.finished_at,GREATEST(j.created_at,j.sent_at,a.created_at,a.finished_at) AS updated_at
        FROM jobs j
        LEFT JOIN LATERAL (SELECT created_at,finished_at FROM attempts WHERE job_id=j.id ORDER BY number DESC LIMIT 1) a ON true
        WHERE j.task_id=t.id
        ORDER BY (j.status IN ('queued','running')) DESC,GREATEST(j.created_at,j.sent_at,a.created_at,a.finished_at) DESC,j.created_at DESC,j.id
        LIMIT 1
      ) current_job ON true
      ORDER BY t.created_at DESC,t.id`, [ownerId, limit])).rows;
    const [previews, canvasRows] = await Promise.all([
      taskSkillPreviews(db, ownerId, rows),
      rows.length ? db.query(`SELECT c.id,c.task_id AS "taskId",c.result_id AS "resultId",c.status,
        c.project_id AS "projectId",c.updated_at AS "updatedAt"
        FROM canvas_imports c JOIN tasks t ON t.id=c.task_id AND t.owner_id=c.owner_id
        JOIN results r ON r.id=c.result_id AND r.task_id=c.task_id
        WHERE c.owner_id=$1 AND c.task_id=ANY($2::uuid[])`, [ownerId, rows.map(row => row.id)]) : Promise.resolve({ rows: [] }),
    ]);
    const imports = new Map<string, TaskCanvasImport[]>();
    for (const row of canvasRows.rows) {
      const records = imports.get(row.taskId) ?? [];
      records.push(row as TaskCanvasImport);
      imports.set(row.taskId, records);
    }
    return rows.map(row => {
      const job = row.job as SummaryJob | null;
      const phase = job?.payload._progress;
      const phaseUpdatedAt = phase && typeof phase === 'object' && 'updatedAt' in phase ? phase.updatedAt : null;
      const progress = taskProgress(row.status, job, Boolean(row.latestResultId));
      const canvasImports = imports.get(row.id) ?? [];
      return {
        id: row.id, name: row.name, status: row.status, parentId: row.parentId, createdAt: row.createdAt,
        updatedAt: latestTimestamp([row.createdAt, row.resultCreatedAt, job?.updatedAt, phaseUpdatedAt, ...canvasImports.map(item => item.updatedAt)]),
        thumbnailMediaId: row.thumbnailMediaId ?? null, latestResultId: row.latestResultId, activeJobs: row.activeJobs,
        latestJob: job ? { id: job.id, kind: job.kind, status: job.status, error: job.error, attempts: job.attempts,
          createdAt: job.createdAt, sentAt: job.sentAt, finishedAt: job.finishedAt, progress, provider: providerSummary(job.frozenProvider, job.kind) } : null,
        progress,
        skillPreviews: previews.get(row.id) ?? [],
        canvasUpload: taskCanvasStatus(row.latestResultId, canvasImports),
      };
    });
  }
  app.post('/api/tasks', async request => {
    const input = creationSchema.parse(request.body);
    if (new Set(input.media.map(x => x.id)).size !== input.media.length) throw new AppError(400, '同一图片不能绑定多个角色');
    await normalizeTaskProductGroups(db, input, request.user.id);
    if (!input.media.some(x => x.role === 'product')) throw new AppError(400, '请指定至少一张主商品图');
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
        preview: freezeSkillPreview(detail.files),
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
  app.get('/api/tasks', async request => summaries(request.user.id, 200));
  app.get('/api/task-board', async request => summaries(request.user.id, 100));
  app.get('/api/tasks/:id', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const task = await taskRow(context, id, request.user.id);
    const results = (await db.query('SELECT id,number,output,confirmed,created_at AS "createdAt" FROM results WHERE task_id=$1 ORDER BY number DESC', [id])).rows;
    const jobs = (await db.query('SELECT id,kind,status,error,attempts,payload,provider AS "frozenProvider",sent_at AS "sentAt" FROM jobs WHERE task_id=$1 ORDER BY created_at', [id])).rows
      .map(({ frozenProvider, ...job }) => ({ ...job, provider: providerSummary(frozenProvider, job.kind), progress: taskProgress(task.status, job, Boolean(results.length)) }));
    const assets = (await db.query('SELECT id,name,kind,media_id AS "mediaId",task_id AS "taskId",result_id AS "resultId",parent_id AS "parentId",confirmed,batch FROM assets WHERE task_id=$1 AND owner_id=$2 ORDER BY created_at', [id, request.user.id])).rows.map(x => ({ ...x, stale: Boolean(results[0] && x.resultId !== results[0].id) }));
    return { id, name: task.name, status: task.status, createdAt: task.created_at, snapshot: task.snapshot, results, jobs, assets };
  });
  app.post('/api/tasks/:id/generate', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ key: z.string().uuid(), costAccepted: context.singleUserMode ? z.boolean().optional() : z.literal(true) }).parse(request.body);
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
      validateProductGroupReferences(task.snapshot, parsed.shots);
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
