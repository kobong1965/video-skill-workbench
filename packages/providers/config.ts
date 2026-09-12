import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../../apps/api/context';
import { validateEndpoint } from './network';

export const providerSchema = z.object({
  enabled: z.boolean(), protocol: z.literal('openai-compatible'),
  baseUrl: z.string().max(500), model: z.string().trim().min(1).max(100),
  apiKey: z.string().max(4000).optional(),
  vision: z.boolean().default(false), references: z.boolean().default(false), multiReference: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(10).max(300).default(120),
  outputHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).max(10).default([]),
  jsonMode: z.boolean().default(true),
});
export type ProviderConfig = Omit<z.infer<typeof providerSchema>, 'apiKey'> & { sealedKey: string };
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
export function publicProvider(config: ProviderConfig | null) {
  if (!config) return { enabled: false, configured: false, hasKey: false };
  const { sealedKey, ...safe } = config;
  return { ...safe, configured: Boolean(config.baseUrl && config.model && sealedKey), hasKey: Boolean(sealedKey), supportsQuery: false, actualCostAvailable: false };
}
export async function getProvider(context: AppContext, kind: 'text' | 'image') {
  return ((await context.db.query('SELECT value FROM settings WHERE key=$1', [`provider.${kind}`])).rows[0]?.value ?? null) as ProviderConfig | null;
}
export function assertProvider(config: ProviderConfig | null, kind: 'text' | 'image') {
  if (!config?.enabled || !config.sealedKey) throw new Error(`尚未配置可用的${kind === 'text' ? '文字／视觉' : '图片'}接口`);
  validateEndpoint(config.baseUrl);
  if (kind === 'text' && !config.vision) throw new Error('文字接口尚未确认支持商品图片输入');
  return config;
}
