import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { mkdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { registerAuth } from './auth';
import { registerMedia } from './media';
import { registerSkills } from './skills';
import { registerDrafts } from './drafts';
import { registerSettings } from './settings';
import { registerTasks } from './tasks';
import { registerJobActions } from './job-actions';
import { registerAssets } from './assets';
import { registerExports } from './exports';
import { registerCanvas } from './canvas';
import { registerProductSets } from './product-sets';
import { registerProductCatalog } from './product-catalog';
import { AppError, type AppContext } from './context';

export async function buildApp(context: AppContext) {
  await mkdir(context.dataRoot, { recursive: true });
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: false });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 150 * 1024 * 1024, files: 1, fields: 15 } });
  await app.register(rateLimit, { global: !context.singleUserMode, max: 300, timeWindow: '1 minute' });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: '输入格式不正确', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.message });
    const typed = error as Error & { code?: string; statusCode?: number };
    if (typed.code === '23505') return reply.code(409).send({ error: '该名称或提交记录已存在，请刷新后重试' });
    if (typed.statusCode && typed.statusCode < 500) return reply.code(typed.statusCode).send({ error: typed.statusCode === 429 ? '操作过于频繁，请稍后再试' : '请求无效或文件超过限制' });
    console.error('[api-error]', typed.code ?? typed.name, typed.message.replace(/(postgres(?:ql)?:\/\/)[^@]+@/g, '$1[redacted]@'));
    return reply.code(500).send({ error: '保存或读取失败，请重试；已有资料不会清空' });
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff'); reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin'); reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });
  await registerAuth(app, context);
  await registerMedia(app, context);
  await registerSkills(app, context);
  await registerDrafts(app, context);
  await registerSettings(app, context);
  await registerTasks(app, context);
  await registerJobActions(app, context);
  await registerAssets(app, context);
  await registerProductSets(app, context);
  await registerProductCatalog(app, context);
  await registerExports(app, context);
  await registerCanvas(app, context);
  app.get('/api/health', async request => {
    const desktopRelease = process.env.VSW_RELEASE_ID ?? 'development';
    const challenge = (request.query as Record<string, unknown>).challenge;
    const proof = typeof challenge === 'string' && /^[a-f0-9]{32}$/.test(challenge)
      ? createHmac('sha256', Buffer.from(context.masterKey, 'hex')).update(`video-skill-workbench|${desktopRelease}|${challenge}`).digest('hex') : undefined;
    return { ok: true, application: 'video-skill-workbench', desktopRelease, proof };
  });
  return app;
}
