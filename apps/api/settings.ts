import { z } from 'zod';
import { providerSchema, getProvider, publicProvider, encryptSecret } from '../../packages/providers/config';
import { validateEndpoint } from '../../packages/providers/network';
import { admin, AppError, type Routes } from './context';
import { transaction } from '../../packages/storage/database';
import type { Capability } from '../../packages/contracts';

export const defaultCapabilities: Record<string, Capability> = {
  'seedance-2.0': { min: 4, max: 15, verified: false, source: '项目需求基线，使用前请按实际画布核验', checkedAt: '2026-09-08' },
  'seedance-2.5': { min: 4, max: 30, verified: false, source: '项目需求基线，使用前请按实际画布核验', checkedAt: '2026-09-08' },
};
export const registerSettings: Routes = async (app, context) => {
  const { db } = context;
  app.get('/api/config', async request => ({
    testMode: Boolean(context.testMode),
    text: publicProvider(await getProvider(context, 'text')), image: publicProvider(await getProvider(context, 'image')),
    capabilities: (await db.query("SELECT value FROM settings WHERE key='capabilities'")).rows[0]?.value ?? defaultCapabilities,
    quotas: (await db.query('SELECT kind,allowance,used,reserved FROM quotas WHERE user_id=$1', [request.user.id])).rows,
  }));
  app.put('/api/admin/providers/:kind', async request => {
    admin(request); const { kind } = z.object({ kind: z.enum(['text', 'image']) }).parse(request.params);
    const input = providerSchema.parse(request.body);
    try { validateEndpoint(input.baseUrl); } catch (error) { throw new AppError(400, (error as Error).message); }
    const prior = await getProvider(context, kind); const { apiKey, ...rest } = input;
    const sealedKey = apiKey ? encryptSecret(apiKey, context.masterKey) : prior?.sealedKey ?? '';
    if (input.enabled && !sealedKey) throw new AppError(400, '启用接口前请填写密钥');
    await transaction(db, async client => {
      await client.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()', [`provider.${kind}`, { ...rest, sealedKey }]);
      await client.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [request.user.id, 'provider.updated', kind]);
    });
    return publicProvider({ ...rest, sealedKey });
  });
  app.get('/api/admin/quotas', async request => { admin(request); return (await db.query('SELECT user_id AS "userId",kind,allowance,used,reserved FROM quotas')).rows; });
  app.put('/api/admin/quotas/:id', async request => {
    admin(request); const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const limits = z.object({ text: z.number().int().min(0).max(100000), image: z.number().int().min(0).max(100000) }).parse(request.body);
    if (!(await db.query('SELECT 1 FROM users WHERE id=$1', [id])).rowCount) throw new AppError(404, '账号不存在');
    await transaction(db, async client => {
      for (const kind of ['text', 'image'] as const) await client.query('INSERT INTO quotas(user_id,kind,allowance) VALUES($1,$2,$3) ON CONFLICT(user_id,kind) DO UPDATE SET allowance=excluded.allowance', [id, kind, limits[kind]]);
      await client.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [request.user.id, 'quota.updated', id]);
    });
    return { ok: true };
  });
  app.put('/api/admin/capabilities', async request => {
    admin(request);
    const cap = z.object({ min: z.number().positive().max(300), max: z.number().positive().max(300), source: z.string().min(1).max(500), checkedAt: z.iso.date(), verified: z.boolean() }).refine(x => x.min <= x.max, '最短时长不能超过上限');
    const value = z.object({ 'seedance-2.0': cap, 'seedance-2.5': cap }).parse(request.body);
    await db.query("INSERT INTO settings(key,value) VALUES('capabilities',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [value]);
    return { ok: true };
  });
};
