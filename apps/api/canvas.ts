import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type Routes } from './context';
import { taskRow } from './task-service';
import { boundAssets } from './asset-service';
import { skillDetail } from './skills';
import { ownedMedia } from '../../packages/storage/private-files';
import { transaction } from '../../packages/storage/database';
import { LibTVClient, canvasError } from '../../packages/canvas/cli';
import { planCanvasImport, type CanvasMaterial } from '../../packages/canvas/planner';
import { CanvasImportRunner, importInfo, importSteps, type ImportRow } from '../../packages/canvas/import-service';

const paramsSchema = z.object({ id: z.string().uuid() });
const projectIdSchema = z.string().regex(/^[a-zA-Z0-9-]{16,64}$/);
export const registerCanvas: Routes = async (app, context) => {
  const cli = new LibTVClient(); const runner = new CanvasImportRunner(context, cli);
  app.addHook('onReady', () => runner.recover());
  app.addHook('onClose', () => runner.close());
  app.get('/api/canvas/connection', async () => {
    let version: string;
    try { version = String(await cli.execute(['--version'])); } catch (error) { return { available: false, connected: false, error: canvasError(error) }; }
    try {
      const info = await cli.execute(['account', 'info']) as { activeAccount?: { accountName?: string } };
      return { available: true, connected: true, version, accountName: info.activeAccount?.accountName ?? '' };
    } catch (error) { return { available: true, connected: false, version, error: canvasError(error) }; }
  });
  app.get('/api/canvas/projects', async request => {
    const input = z.object({ workspace: z.string().regex(/^\d+$/).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    try {
      const args = ['project', 'list', '--page', String(input.page), '--page-size', String(input.pageSize), ...(input.workspace ? ['-w', input.workspace] : [])];
      const projects = await cli.execute(args) as { projectMetaList?: { uuid: string; name: string; folderId?: string | number }[]; total?: number };
      const workspaces = await cli.execute(['workspace', 'list', '--page', '1', '--page-size', '100']) as { folders?: { id: string | number; name: string }[] };
      return { projects: (projects.projectMetaList ?? []).map(x => ({ id: x.uuid, name: x.name || '未命名画布', ...(x.folderId ? { workspaceId: String(x.folderId) } : {}) })), total: projects.total ?? 0,
        workspaces: (workspaces.folders ?? []).map(x => ({ id: String(x.id), name: x.name || `工作区 ${x.id}` })) };
    } catch (error) { throw new AppError(409, canvasError(error)); }
  });
  app.post('/api/tasks/:id/canvas-imports', async request => {
    const { id } = paramsSchema.parse(request.params);
    const input = z.object({ resultId: z.string().uuid(), projectId: projectIdSchema.optional(), newProjectName: z.string().trim().min(1).max(100).optional(), key: z.string().uuid() }).parse(request.body);
    const task = await taskRow(context, id, request.user.id);
    const result = (await context.db.query('SELECT output FROM results WHERE id=$1 AND task_id=$2', [input.resultId, id])).rows[0];
    if (!result) throw new AppError(404, '结果版本不存在');
    if (input.projectId && input.newProjectName) throw new AppError(400, '请选择一个目标画布');
    const prior = (await context.db.query('SELECT * FROM canvas_imports WHERE owner_id=$1 AND submit_key=$2', [request.user.id, input.key])).rows[0] as ImportRow | undefined;
    if (prior) {
      if (prior.task_id !== id || prior.result_id !== input.resultId || (input.projectId && prior.project_id !== input.projectId)) throw new AppError(409, '此提交标识已用于其他导入');
      return importInfo(prior);
    }
    const assets: CanvasMaterial[] = [];
    for (const selected of task.snapshot.skills) {
      const skill = await skillDetail(context, request.user, selected.id, selected.versionId);
      if (!skill.requirements?.referenceVideoRequired) continue;
      const benchmark = skill.requirements.benchmarkVideo;
      if (!benchmark?.mediaId) throw new AppError(409, `脚本「${skill.name}」缺少必需原对标视频，请补齐该版本 Skill 包后再导入画布`);
      const media = (await context.db.query('SELECT id,mime FROM media WHERE id=$1', [benchmark.mediaId])).rows[0];
      if (media?.mime !== 'video/mp4') throw new AppError(409, `脚本「${skill.name}」的必需原对标视频不可用`);
      assets.push({ id: media.id, kind: 'benchmark', mime: media.mime, name: benchmark.path.split('/').at(-1) ?? '原对标.mp4', batch: null, skillVersionIds: [selected.versionId] });
    }
    for (const asset of (await boundAssets(context, id, input.resultId)).filter(x => !x.stale)) {
      const media = await ownedMedia(context, asset.mediaId, request.user.id);
      assets.push({ id: asset.mediaId, name: asset.name, mime: media.mime, kind: asset.kind, batch: asset.batch });
    }
    for (const media of task.snapshot.media) await ownedMedia(context, media.id, request.user.id);
    const importId = randomUUID();
    let plan;
    try { plan = planCanvasImport(importId, task.snapshot, result.output, assets); } catch (error) { throw new AppError(409, canvasError(error)); }
    const row = await transaction(context.db, async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [request.user.id]);
      const existing = (await client.query('SELECT * FROM canvas_imports WHERE owner_id=$1 AND submit_key=$2', [request.user.id, input.key])).rows[0] as ImportRow | undefined;
      if (existing) {
        if (existing.task_id !== id || existing.result_id !== input.resultId) throw new AppError(409, '此提交标识已用于其他导入');
        return existing;
      }
      const projectName = `工作台 · ${input.newProjectName ?? task.name} · SW-${importId.slice(0, 8)}`;
      return (await client.query('INSERT INTO canvas_imports(id,owner_id,task_id,result_id,submit_key,project_id,new_project_name,plan,steps) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [importId, request.user.id, id, input.resultId, input.key, input.projectId ?? null, input.projectId ? null : projectName, plan, JSON.stringify(importSteps(plan))])).rows[0] as ImportRow;
    });
    runner.enqueue(row.id); return importInfo(row);
  });
  app.get('/api/tasks/:id/canvas-imports', async request => {
    const { id } = paramsSchema.parse(request.params); await taskRow(context, id, request.user.id);
    const { resultId } = z.object({ resultId: z.string().uuid().optional() }).parse(request.query);
    return (await context.db.query('SELECT * FROM canvas_imports WHERE task_id=$1 AND owner_id=$2 AND ($3::uuid IS NULL OR result_id=$3) ORDER BY created_at DESC LIMIT 50', [id, request.user.id, resultId ?? null])).rows.map(row => importInfo(row));
  });
  app.get('/api/canvas/imports/:id', async request => {
    const { id } = paramsSchema.parse(request.params);
    const row = (await context.db.query('SELECT * FROM canvas_imports WHERE id=$1 AND owner_id=$2', [id, request.user.id])).rows[0];
    if (!row) throw new AppError(404, '导入记录不存在'); return importInfo(row);
  });
  app.post('/api/canvas/imports/:id/retry', async request => {
    const { id } = paramsSchema.parse(request.params); z.object({ key: z.string().uuid() }).parse(request.body);
    const row = (await context.db.query('SELECT * FROM canvas_imports WHERE id=$1 AND owner_id=$2', [id, request.user.id])).rows[0];
    if (!row) throw new AppError(404, '导入记录不存在');
    if (['queued', 'running', 'succeeded'].includes(row.status)) return importInfo(row);
    const updated = (await context.db.query("UPDATE canvas_imports SET status='queued',error=null,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
    runner.enqueue(id); return importInfo(updated);
  });
};
