import { createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AppError, type Routes } from './context';
import { saveMedia } from '../../packages/storage/private-files';

export const registerMedia: Routes = async (app, context) => {
  app.post('/api/media', async request => {
    const file = await request.file();
    if (!file) throw new AppError(400, '请上传一个文件');
    const bytes = await file.toBuffer();
    if (file.file.truncated) throw new AppError(400, '文件超过上传限制');
    return saveMedia(context, request.user.id, file.filename, bytes);
  });
  app.get('/api/media/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = (await context.db.query(`SELECT m.* FROM media m WHERE m.id=$1 AND (m.owner_id=$2 OR EXISTS(SELECT 1 FROM skill_files f JOIN skill_versions v ON f.version_id=v.id JOIN skills s ON v.skill_id=s.id WHERE f.media_id=m.id AND s.visibility='public'))`, [id, request.user.id])).rows[0];
    if (!row) throw new AppError(404, '资料不存在或无权访问');
    const size = Number(row.size); const filename = path.resolve(context.dataRoot, row.disk_path);
    if (!filename.startsWith(path.resolve(context.dataRoot) + path.sep)) throw new AppError(400, '文件路径无效');
    reply.type(row.mime).header('Accept-Ranges', 'bytes');
    const download = (request.query as Record<string, string>).download === '1';
    const inline = !download && /^(image|video)\//.test(row.mime);
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(filename, { start, end }));
    }
    return reply.header('Content-Length', size).send(createReadStream(filename));
  });
};
