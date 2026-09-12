import { runtimeContext } from '../api/runtime';
import { claimJob, recoverExpiredJobs, runJob } from './queue';

const context = await runtimeContext();
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
console.log('生成任务后台已启动；未配置 API 时不会发出生成请求。');
while (!stopping) {
  try {
    await recoverExpiredJobs(context);
    const job = await claimJob(context);
    if (job) await runJob(context, job);
    else await new Promise(resolve => setTimeout(resolve, 1000));
  } catch { console.error('[worker] 后台暂时无法读取任务，将保留现有进度并重新连接'); await new Promise(resolve => setTimeout(resolve, 3000)); }
}
await context.db.end();
