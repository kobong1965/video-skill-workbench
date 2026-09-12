import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type Routes } from './context';
import { taskRow } from './task-service';
import { makeBundle } from '../../packages/storage/export-bundle';
import { saveMedia, ownedMedia, mediaBytes } from '../../packages/storage/private-files';

export const registerExports: Routes = async (app, context) => {
  const { db } = context;
  app.post('/api/tasks/:id/export', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ resultId: z.string().uuid(), complete: z.boolean() }).parse(request.body);
    const task = await taskRow(context, id, request.user.id);
    const result = (await db.query('SELECT * FROM results WHERE id=$1 AND task_id=$2', [input.resultId, id])).rows[0];
    if (!result) throw new AppError(404, '结果不存在');
    let bundle;
    try { bundle = await makeBundle(context, request.user.id, id, result.id, task.snapshot, result.output, input.complete, result.confirmed); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError(409, (error as Error).message); }
    const media = await saveMedia(context, request.user.id, `${task.name}-R${result.number}-${input.complete ? '完整包' : '文字与已有素材'}.zip`, bundle.bytes);
    const exportId = randomUUID();
    await db.query('INSERT INTO exports(id,owner_id,task_id,result_id,media_id,complete,manifest) VALUES($1,$2,$3,$4,$5,$6,$7)', [exportId, request.user.id, id, result.id, media.id, input.complete, bundle.manifest]);
    if (input.complete) await db.query("UPDATE tasks SET status='completed' WHERE id=$1 AND $2=(SELECT id FROM results WHERE task_id=$1 ORDER BY number DESC LIMIT 1)", [id, result.id]);
    return { id: exportId, complete: input.complete, filename: media.name, missing: bundle.manifest.missing };
  });
  app.get('/api/exports/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = (await db.query('SELECT media_id FROM exports WHERE id=$1 AND owner_id=$2', [id, request.user.id])).rows[0];
    if (!item) throw new AppError(404, '导出包不存在或无权访问');
    const media = await ownedMedia(context, item.media_id, request.user.id);
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="video-skill.zip"; filename*=UTF-8''${encodeURIComponent(media.name)}`).send(await mediaBytes(context, media));
  });
  app.get('/api/tasks/:id/exports', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await taskRow(context, id, request.user.id);
    return (await db.query('SELECT id,result_id AS "resultId",complete,created_at AS "createdAt" FROM exports WHERE task_id=$1 AND owner_id=$2 ORDER BY created_at DESC', [id, request.user.id])).rows;
  });
};
