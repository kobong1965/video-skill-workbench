import { runtimeContext } from '../api/runtime';
import { runWorkerLoop } from './pool';

const context = await runtimeContext();
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
console.log('生成任务后台已启动；按接口空位自动并行分配，未配置 API 时不会发出生成请求。');
try {
  await runWorkerLoop(context, {
    stopping: () => stopping,
    onError: () => console.error('[worker] 后台暂时无法读取任务，将保留现有进度并重新连接'),
  });
} finally { await context.db.end(); }
