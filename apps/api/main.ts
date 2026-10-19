import fastifyStatic from '@fastify/static';
import { buildApp } from './app';
import { runtimeContext } from './runtime';

const context = await runtimeContext();
const app = await buildApp(context);
if (process.env.VSW_SERVE_STATIC === '1') {
  if (!process.env.VSW_OUTPUT_ROOT) throw new Error('缺少网页构建目录');
  await app.register(fastifyStatic, { root: process.env.VSW_OUTPUT_ROOT });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
}
await app.listen({ host: '127.0.0.1', port: Number(process.env.VSW_PORT ?? 4178) });
console.log(`工作台已就绪：${context.origin}`);
console.log(`首次安装码文件：${context.dataRoot}/本机安装码.txt`);
let shutdown: Promise<void> | undefined;
function stop() {
  return shutdown ??= (async () => {
    // Fastify rejects new intake before waiting for requests and onClose hooks.
    await app.close(); await context.db.end(); process.exit(0);
  })();
}
const requestStop = () => { void stop().catch(() => console.error('API关闭尚未完成；正在保留现有任务和数据库连接。')); };
process.on('SIGINT', requestStop); process.on('SIGTERM', requestStop);
