import { z } from 'zod';
import { SCHEDULER_LOCK_KEY, providerSchema, providerPoolSchema, executionSchema, eligibleProviders, getProviderPool, getExecutionSettings, publicProvider, encryptSecret } from '../../packages/providers/config';
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
  app.get('/api/config', async request => {
    const [text, image, execution, counts] = await Promise.all([
      getProviderPool(context, 'text'), getProviderPool(context, 'image'), getExecutionSettings(context),
      db.query("SELECT kind,coalesce(provider->>'id','legacy-'||kind) AS id,count(*)::integer AS active FROM jobs WHERE status='running' GROUP BY kind,coalesce(provider->>'id','legacy-'||kind)"),
    ]);
    const profiles = (pool: Awaited<ReturnType<typeof getProviderPool>>, kind: string) => pool.map(config => ({
      ...publicProvider(config, context.singleUserMode), id: config.id ?? `legacy-${kind}`,
      name: config.name ?? (kind === 'text' ? '文字／视觉接口' : '图片接口'), maxConcurrency: config.maxConcurrency ?? 4,
      activeJobs: counts.rows.find(row => row.kind === kind && row.id === (config.id ?? `legacy-${kind}`))?.active ?? 0,
    }));
    const representative = (pool: Awaited<ReturnType<typeof getProviderPool>>, kind: 'text' | 'image') =>
      publicProvider(eligibleProviders(pool, kind, context.singleUserMode)[0] ?? pool[0] ?? null, context.singleUserMode);
    return {
      testMode: Boolean(context.testMode),
      singleUserMode: Boolean(context.singleUserMode),
      text: representative(text, 'text'), image: representative(image, 'image'),
      providerPools: { text: profiles(text, 'text'), image: profiles(image, 'image') }, execution,
      capabilities: (await db.query("SELECT value FROM settings WHERE key='capabilities'")).rows[0]?.value ?? defaultCapabilities,
      quotas: (await db.query('SELECT kind,allowance,used,reserved FROM quotas WHERE user_id=$1', [request.user.id])).rows,
    };
  });
  app.put('/api/admin/provider-pools/:kind', async request => {
    admin(request); const { kind } = z.object({ kind: z.enum(['text', 'image']) }).parse(request.params);
    const input = providerPoolSchema.parse(request.body);
    return transaction(db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEDULER_LOCK_KEY]);
      const prior = await getProviderPool(context, kind, client);
      const providers = input.providers.map(({ apiKey, ...rest }) => {
        if (rest.baseUrl || rest.enabled) {
          try { validateEndpoint(rest.baseUrl); } catch (error) { throw new AppError(400, (error as Error).message); }
        }
        const sealedKey = apiKey ? encryptSecret(apiKey, context.masterKey) : prior.find(p => p.id === rest.id)?.sealedKey ?? '';
        if (rest.enabled && !sealedKey) throw new AppError(400, `启用“${rest.name}”前请填写密钥`);
        return { ...rest, sealedKey };
      });
      await client.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()', [`provider-pool.${kind}`, JSON.stringify(providers)]);
      await client.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [request.user.id, 'provider_pool.updated', kind]);
      return { providers: providers.map(p => publicProvider(p, context.singleUserMode)) };
    });
  });
  app.put('/api/admin/execution', async request => {
    admin(request); const execution = executionSchema.parse(request.body);
    await transaction(db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEDULER_LOCK_KEY]);
      await client.query("INSERT INTO settings(key,value) VALUES('execution',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()", [execution]);
      await client.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [request.user.id, 'execution.updated', 'execution']);
    });
    return execution;
  });
  app.put('/api/admin/providers/:kind', async request => {
    admin(request); const { kind } = z.object({ kind: z.enum(['text', 'image']) }).parse(request.params);
    const input = providerSchema.parse(request.body);
    try { validateEndpoint(input.baseUrl); } catch (error) { throw new AppError(400, (error as Error).message); }
    const { apiKey, ...rest } = input;
    const saved = await transaction(db, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEDULER_LOCK_KEY]);
      const pool = await getProviderPool(context, kind, client);
      const prior = pool.find(p => p.id === `legacy-${kind}`) ?? pool[0];
      const sealedKey = apiKey ? encryptSecret(apiKey, context.masterKey) : prior?.sealedKey ?? '';
      if (input.enabled && !sealedKey) throw new AppError(400, '启用接口前请填写密钥');
      await client.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()', [`provider.${kind}`, { ...rest, sealedKey }]);
      if ((await client.query('SELECT 1 FROM settings WHERE key=$1', [`provider-pool.${kind}`])).rowCount) {
        const replacement = { ...rest, sealedKey, id: prior?.id ?? `legacy-${kind}`, name: prior?.name ?? (kind === 'text' ? '文字／视觉接口' : '图片接口'), maxConcurrency: prior?.maxConcurrency ?? 4 };
        const next = prior ? pool.map(p => p.id === prior.id ? replacement : p) : [replacement];
        await client.query('UPDATE settings SET value=$2,updated_at=now() WHERE key=$1', [`provider-pool.${kind}`, JSON.stringify(next)]);
      }
      await client.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [request.user.id, 'provider.updated', kind]);
      return { ...rest, sealedKey };
    });
    return publicProvider(saved, context.singleUserMode);
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
