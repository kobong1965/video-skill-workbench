import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError, type Routes } from './context';
import { ownedMedia } from '../../packages/storage/private-files';

export const registerDrafts: Routes = async (app, context) => {
  const { db } = context;
  app.get('/api/drafts', async request => (await db.query('SELECT id,name,input,updated_at AS "updatedAt" FROM drafts WHERE owner_id=$1 ORDER BY updated_at DESC', [request.user.id])).rows);
  app.post('/api/drafts', async request => {
    const input = z.object({ id: z.string().uuid().optional(), name: z.string().max(100), input: z.record(z.string(), z.unknown()) }).parse(request.body);
    const media = z.array(z.object({ id: z.string().uuid() })).parse(input.input.media ?? []);
    for (const item of media) await ownedMedia(context, item.id, request.user.id);
    const id = input.id ?? randomUUID();
    if (input.id) {
      const updated = await db.query('UPDATE drafts SET name=$1,input=$2,updated_at=now() WHERE id=$3 AND owner_id=$4', [input.name, input.input, id, request.user.id]);
      if (!updated.rowCount) throw new AppError(404, '草稿不存在');
    } else await db.query('INSERT INTO drafts(id,owner_id,name,input) VALUES($1,$2,$3,$4)', [id, request.user.id, input.name, input.input]);
    return { id };
  });
};
