import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { AppContext } from '../../apps/api/context';
import { validateEndpoint } from './network';

export const SCHEDULER_LOCK_KEY = 719340012;

export const providerSchema = z.object({
  enabled: z.boolean(), protocol: z.literal('openai-compatible'),
  baseUrl: z.string().max(500), model: z.string().trim().min(1).max(100),
  apiKey: z.string().max(4000).optional(),
  vision: z.boolean().default(false), references: z.boolean().default(false), multiReference: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(0).max(3600).default(0),
  outputHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).max(10).default([]),
  jsonMode: z.boolean().default(true),
});
export const providerProfileSchema = providerSchema.extend({
  id: z.string().regex(/^(?:legacy-(?:text|image)|[0-9a-f-]{36})$/i),
  name: z.string().trim().min(1).max(60),
  maxConcurrency: z.number().int().min(1).max(32).default(4),
});
export const providerPoolSchema = z.object({ providers: z.array(providerProfileSchema).max(16) })
  .refine(value => new Set(value.providers.map(p => p.id)).size === value.providers.length, '接口 ID 不能重复');
export const executionSchema = z.object({ maxConcurrentJobs: z.number().int().min(1).max(32).default(8) });
export type ProviderConfig = Omit<z.infer<typeof providerSchema>, 'apiKey'> & {
  sealedKey: string; id?: string; name?: string; maxConcurrency?: number; routing?: 'auto';
};
export function encryptSecret(secret: string, master: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(master, 'hex'), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join('.');
}
export function decryptSecret(sealed: string, master: string) {
  const [iv, tag, data] = sealed.split('.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(master, 'hex'), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString('utf8');
}
export function publicProvider(config: ProviderConfig | null, singleUserMode = false) {
  if (!config) return { enabled: false, configured: false, hasKey: false };
  const { sealedKey, routing: _routing, ...safe } = config;
  return { ...safe, timeoutSeconds: effectiveProviderTimeout(config.timeoutSeconds, singleUserMode), configured: Boolean(config.baseUrl && config.model && sealedKey), hasKey: Boolean(sealedKey), supportsQuery: false, actualCostAvailable: false };
}
export async function getProviderPool(context: AppContext, kind: 'text' | 'image', client?: PoolClient): Promise<ProviderConfig[]> {
  const db = client ?? context.db;
  const pool = (await db.query('SELECT value FROM settings WHERE key=$1', [`provider-pool.${kind}`])).rows[0];
  // An explicitly empty pool disables routing; it must not resurrect the old key.
  if (pool) return Array.isArray(pool.value) ? pool.value : [];
  const legacy = (await db.query('SELECT value FROM settings WHERE key=$1', [`provider.${kind}`])).rows[0]?.value as ProviderConfig | undefined;
  return legacy ? [{ ...legacy, id: `legacy-${kind}`, name: kind === 'text' ? '文字／视觉接口' : '图片接口', maxConcurrency: 4 }] : [];
}
export async function getExecutionSettings(context: AppContext, client?: PoolClient) {
  const value = (await (client ?? context.db).query("SELECT value FROM settings WHERE key='execution'")).rows[0]?.value;
  const parsed = executionSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { maxConcurrentJobs: 8 };
}
export function eligibleProviders(providers: ProviderConfig[], kind: 'text' | 'image', singleUserMode = false, payload: Record<string, unknown> = {}) {
  const refs = Array.isArray(payload.referenceMediaIds) ? payload.referenceMediaIds.length : 0;
  return providers.filter(config => {
    try { assertProvider(config, kind, singleUserMode); } catch { return false; }
    return kind !== 'image' || singleUserMode || ((!refs || config.references) && (refs < 2 || config.multiReference));
  });
}
export async function getProvider(context: AppContext, kind: 'text' | 'image') {
  const pool = await getProviderPool(context, kind);
  return eligibleProviders(pool, kind, context.singleUserMode)[0] ?? pool[0] ?? null;
}
export async function automaticProvider(context: AppContext, kind: 'text' | 'image', payload: Record<string, unknown> = {}, client?: PoolClient): Promise<ProviderConfig> {
  const pool = await getProviderPool(context, kind, client);
  const provider = eligibleProviders(pool, kind, context.singleUserMode, payload)[0];
  if (!provider) throw new Error(kind === 'text' ? '尚未配置可用的文字／视觉接口' : '尚未配置可用且支持本次参考图的图片接口');
  return { ...provider, routing: 'auto' };
}
export function providerSummary(config: ProviderConfig | null, kind: 'text' | 'image') {
  if (!config || config.routing === 'auto') return null;
  return { id: config.id ?? `legacy-${kind}`, name: config.name ?? (kind === 'text' ? '文字／视觉接口' : '图片接口'), model: config.model };
}
export function effectiveProviderTimeout(seconds: number, singleUserMode = false) {
  return singleUserMode && seconds <= 300 ? 0 : seconds;
}
export function assertProvider(config: ProviderConfig | null, kind: 'text' | 'image', singleUserMode = false) {
  if (!config?.enabled || !config.sealedKey) throw new Error(`尚未配置可用的${kind === 'text' ? '文字／视觉' : '图片'}接口`);
  validateEndpoint(config.baseUrl);
  if (kind === 'text' && !config.vision && !singleUserMode) throw new Error('文字接口尚未确认支持商品图片输入');
  return config;
}
