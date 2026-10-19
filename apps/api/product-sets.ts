import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { CreationInput, ProductImageSet, ProductImageSetMedia } from '../../packages/contracts';
import { transaction, type Database } from '../../packages/storage/database';
import { AppError, type Routes } from './context';

const params = z.object({ id: z.string().uuid() });
const productSetInput = z.object({
  styleNumber: z.string().trim().min(1).max(80),
  name: z.string().trim().max(100).default(''),
  media: z.array(z.object({ id: z.string().uuid(), role: z.enum(['product', 'detail', 'comparison']) })).min(1).max(12),
}).superRefine((input, context) => {
  if (!input.media.some(item => item.role === 'product')) context.addIssue({ code: 'custom', path: ['media'], message: '请指定至少一张主商品图' });
  if (new Set(input.media.map(item => item.id)).size !== input.media.length) context.addIssue({ code: 'custom', path: ['media'], message: '同一图片不能绑定多个角色' });
});
type ProductSetInput = z.infer<typeof productSetInput>;

const selectProductSets = `SELECT s.id,s.style_number AS "styleNumber",s.name,
  s.created_at AS "createdAt",s.updated_at AS "updatedAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'role',p.role,'name',m.name) ORDER BY p.position)
    FROM product_set_media p JOIN media m ON m.id=p.media_id AND m.owner_id=s.owner_id
    WHERE p.product_set_id=s.id),'[]'::jsonb) AS media
  FROM product_sets s`;

function serialize(row: { id: string; styleNumber: string; name: string; media: ProductImageSetMedia[]; createdAt: Date; updatedAt: Date }): ProductImageSet {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function readProductSet(db: Database | PoolClient, id: string, ownerId: string): Promise<ProductImageSet> {
  const row = (await db.query(`${selectProductSets} WHERE s.id=$1 AND s.owner_id=$2`, [id, ownerId])).rows[0];
  if (!row) throw new AppError(404, '款号图套不存在或无权访问');
  return serialize(row);
}

/** Task snapshots copy this metadata once; subsequent set edits never update existing tasks. */
export async function ownedProductSetMetadata(db: Database, id: string, ownerId: string): Promise<{ styleNumber: string }> {
  const row = (await db.query('SELECT style_number AS "styleNumber" FROM product_sets WHERE id=$1 AND owner_id=$2', [id, ownerId])).rows[0];
  if (!row) throw new AppError(404, '款号图套不存在或无权访问');
  return row;
}

/** Validate current ownership and membership once, then freeze canonical group metadata in the task. */
export async function normalizeTaskProductGroups(db: Database, input: CreationInput, ownerId: string): Promise<void> {
  if (!input.productGroups) {
    if (input.productSetId) input.styleNumber = (await ownedProductSetMetadata(db, input.productSetId, ownerId)).styleNumber;
    return;
  }
  // One statement reads all sets and their bindings at the same database snapshot.
  const rows = (await db.query(`${selectProductSets} WHERE s.owner_id=$1 AND s.id=ANY($2::uuid[])`, [ownerId, input.productGroups.map(group => group.productSetId)])).rows as ProductImageSet[];
  const sets = new Map(rows.map(set => [set.id, set]));
  if (sets.size !== input.productGroups.length) throw new AppError(404, '款号图套不存在或无权访问');
  const taskMedia = new Map(input.media.map(item => [item.id, item.role]));
  const canonicalRoles = new Map<string, ProductImageSetMedia['role']>();
  const groups = input.productGroups.map((group, index) => {
    const set = sets.get(group.productSetId)!;
    const images = new Map(set.media.map(image => [image.id, image.role]));
    if (group.mediaIds.some(id => !images.has(id))) throw new AppError(400, `图套「${set.styleNumber}」包含不属于该图套的图片，请重新选择`);
    if (group.mediaIds.some(id => !taskMedia.has(id))) throw new AppError(400, `图套「${set.styleNumber}」的分组图片未全部包含在本任务中`);
    // A flattened task media entry cannot represent conflicting per-set purposes without losing meaning.
    for (const id of group.mediaIds) {
      const role = images.get(id)!;
      const previous = canonicalRoles.get(id);
      if (previous && previous !== role) throw new AppError(400, '同一图片在不同图套的用途不一致，请调整图套或移除重复图片');
      canonicalRoles.set(id, role);
    }
    if (!group.mediaIds.some(id => images.get(id) === 'product')) throw new AppError(400, `图套「${set.styleNumber}」必须保留至少一张原图套主图`);
    // Comparison groups are intentionally demoted below. Every other group must have its own product image.
    if (!(input.productUse === 'comparison' && index > 0) && !group.mediaIds.some(id => taskMedia.get(id) === 'product')) {
      throw new AppError(400, `图套「${set.styleNumber}」必须指定至少一张主商品图`);
    }
    return { productSetId: set.id, styleNumber: set.styleNumber, name: set.name, mediaIds: [...group.mediaIds] };
  });
  if (input.productUse === 'comparison') {
    const primary = new Set(groups[0].mediaIds);
    const comparison = new Set(groups.slice(1).flatMap(group => group.mediaIds));
    if ([...comparison].some(id => primary.has(id))) throw new AppError(400, '主商品与对比商品不能共享同一图片，图片角色存在冲突，请分别选择');
    input.media = input.media.map(item => comparison.has(item.id) ? { ...item, role: 'comparison' } : item);
  }
  input.productGroups = groups;
  if (groups.length === 1) {
    input.productSetId = groups[0].productSetId;
    input.styleNumber = groups[0].styleNumber;
  } else {
    delete input.productSetId;
    delete input.styleNumber;
  }
}

async function validateMedia(client: PoolClient, input: ProductSetInput, ownerId: string) {
  const rows = (await client.query('SELECT id,mime FROM media WHERE id=ANY($1::uuid[]) AND owner_id=$2', [input.media.map(item => item.id), ownerId])).rows as { id: string; mime: string }[];
  if (rows.length !== input.media.length) throw new AppError(404, '素材不存在或无权访问');
  if (rows.some(row => !row.mime.startsWith('image/'))) throw new AppError(400, '款号图套只能保存图片');
}

async function replaceBindings(client: PoolClient, id: string, media: ProductSetInput['media']) {
  for (const [position, item] of media.entries()) {
    await client.query('INSERT INTO product_set_media(product_set_id,media_id,role,position) VALUES($1,$2,$3,$4)', [id, item.id, item.role, position]);
  }
}

async function withStyleConflict<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if ((error as { code?: string; constraint?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'product_sets_owner_style_unique') {
      throw new AppError(409, '该款号已保存，请编辑已有图套或使用其他款号');
    }
    throw error;
  }
}

export const registerProductSets: Routes = async (app, context) => {
  const { db } = context;
  app.get('/api/product-sets', async request => {
    // Return the complete lightweight private catalog; no silent LIMIT that hides older styles.
    const rows = (await db.query(`${selectProductSets} WHERE s.owner_id=$1 ORDER BY s.updated_at DESC,s.id`, [request.user.id])).rows;
    return rows.map(serialize);
  });
  app.get('/api/product-sets/:id', async request => {
    const { id } = params.parse(request.params);
    return readProductSet(db, id, request.user.id);
  });
  app.post('/api/product-sets', async request => {
    const input = productSetInput.parse(request.body);
    return withStyleConflict(() => transaction(db, async client => {
      await validateMedia(client, input, request.user.id);
      const id = randomUUID();
      await client.query('INSERT INTO product_sets(id,owner_id,style_number,name) VALUES($1,$2,$3,$4)', [id, request.user.id, input.styleNumber, input.name]);
      await replaceBindings(client, id, input.media);
      return readProductSet(client, id, request.user.id);
    }));
  });
  app.put('/api/product-sets/:id', async request => {
    const { id } = params.parse(request.params);
    const input = productSetInput.parse(request.body);
    return withStyleConflict(() => transaction(db, async client => {
      // Serialize whole-set replacements and establish ownership before validating replacement media.
      const exists = (await client.query('SELECT id FROM product_sets WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, request.user.id])).rowCount;
      if (!exists) throw new AppError(404, '款号图套不存在或无权访问');
      await validateMedia(client, input, request.user.id);
      await client.query('UPDATE product_sets SET style_number=$1,name=$2,updated_at=now() WHERE id=$3', [input.styleNumber, input.name, id]);
      await client.query('DELETE FROM product_set_media WHERE product_set_id=$1', [id]);
      await replaceBindings(client, id, input.media);
      return readProductSet(client, id, request.user.id);
    }));
  });
};
