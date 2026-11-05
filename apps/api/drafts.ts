import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError, type Routes } from './context';
import { ownedMedia } from '../../packages/storage/private-files';
import { MAX_PRODUCT_GROUPS, MAX_TASK_IMAGES, productGroupSchema } from '../../packages/contracts';
import { normalizeTaskProductGroups } from './product-sets';

export const registerDrafts: Routes = async (app, context) => {
  const { db } = context;
  app.get('/api/drafts', async request => (await db.query('SELECT id,name,input,updated_at AS "updatedAt" FROM drafts WHERE owner_id=$1 ORDER BY updated_at DESC', [request.user.id])).rows);
  app.post('/api/drafts', async request => {
    const input = z.object({ id: z.string().uuid().optional(), name: z.string().max(100), input: z.record(z.string(), z.unknown()) }).parse(request.body);
    const media = z.array(z.object({ id: z.string().uuid() })).parse(input.input.media ?? []);
    for (const item of media) await ownedMedia(context, item.id, request.user.id);
    // Incomplete drafts remain saveable (including a group with all images removed).
    // Catalog identity itself always comes from the owner's frozen selection record.
    const rawGroups = input.input.productGroups;
    if (Array.isArray(rawGroups) && rawGroups.some(group => group?.source === 'catalog' || group?.catalogSelectionId || group?.catalog)) {
      const partial = z.object({
        media: z.array(z.object({ id: z.string().uuid(), role: z.enum(['product', 'detail', 'comparison']) })).max(MAX_TASK_IMAGES),
        productGroups: z.array(productGroupSchema.safeExtend({ mediaIds: z.array(z.string().uuid()).max(12) })).max(MAX_PRODUCT_GROUPS),
        market: z.enum(['CN', 'US', 'VN']).optional(), productUse: z.enum(['colors', 'outfit', 'comparison']).optional(),
      }).parse(input.input);
      await normalizeTaskProductGroups(db, partial, request.user.id, true);
      Object.assign(input.input, partial);
      if (partial.productGroups.length !== 1 || partial.productGroups[0].source === 'catalog') { delete input.input.productSetId; delete input.input.styleNumber; }
    }
    const id = input.id ?? randomUUID();
    if (input.id) {
      const updated = await db.query('UPDATE drafts SET name=$1,input=$2,updated_at=now() WHERE id=$3 AND owner_id=$4', [input.name, input.input, id, request.user.id]);
      if (!updated.rowCount) throw new AppError(404, '草稿不存在');
    } else await db.query('INSERT INTO drafts(id,owner_id,name,input) VALUES($1,$2,$3,$4)', [id, request.user.id, input.name, input.input]);
    return { id };
  });
};
