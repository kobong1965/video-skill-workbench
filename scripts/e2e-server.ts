import { harness } from '../tests/helpers';
import fastifyStatic from '@fastify/static';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { claimJob, runJob } from '../apps/worker/queue';

if (!process.env.VSW_TEST_ROOT) throw new Error('测试服务器只能从独立测试入口启动');
const port = Number(process.env.VSW_E2E_PORT ?? 4188);
const h = await harness('browser', `http://127.0.0.1:${port}`); h.context.testMode = true;
const user = await h.account('admin');
await h.db.query("UPDATE users SET username='e2e-admin',display_name='试用测试账号' WHERE id=$1", [user.id]);
const previewUser = await h.account('admin');
await h.db.query("UPDATE users SET username='preview-admin',display_name='预览测试账号' WHERE id=$1", [previewUser.id]);
await writeFile(path.join(process.env.VSW_TEST_ROOT, 'sample-skill.md'), '# 停车场上衣 · 测试样例\n默认17秒全片。\n强自然阳光，真实微风，女生静默展示。平铺在沥青背景。');
const png = await sharp({ create: { width: 600, height: 700, channels: 3, background: '#999' } }).png().toBuffer();
await writeFile(path.join(process.env.VSW_TEST_ROOT, 'sample-product.png'), png);
await h.app.register(fastifyStatic, { root: process.env.VSW_OUTPUT_ROOT! });
await h.app.listen({ host: '127.0.0.1', port });
let active = false;
const timer = setInterval(async () => {
  if (active) return; active = true;
  try {
    const job = await claimJob(h.context);
    if (job) await runJob(h.context, job, { image: async () => png, text: async snapshot => ({ productFacts: [{ text: '测试图片', source: 'visible' }], unknowns: ['成分未提供'], conflicts: [], globalPrompt: '【自动化测试结果，非真实 AI 生成】保持当前商品，使用自然阳光和微风。', shots: snapshot.skills.flatMap(skill => {
      const count = Math.ceil(skill.duration / snapshot.capability.max);
      return Array.from({ length: count }, (_, i) => ({ skillVersionId: skill.versionId, duration: skill.duration / count, title: `测试镜头 ${i + 1}`, prompt: '【测试镜头】自然阳光照射商品，人物保持静默展示。', dialogue: '', translation: '', storyAudio: '自然微风', startState: '人物站立', endState: '自然停留', references: snapshot.media.map(m => m.id) }));
    }), assetPlan: [] }) });
  } finally { active = false; }
}, 300);
async function stop() { clearInterval(timer); await h.close(); process.exit(0); }
process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
