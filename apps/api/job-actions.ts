import { z } from 'zod';
import { AppError, type Routes } from './context';
import { transaction } from '../../packages/storage/database';
import { reserve, assertImageRevision } from './task-service';
import { automaticProvider } from '../../packages/providers/config';

export const registerJobActions: Routes = async (app, context) => {
  app.post('/api/jobs/:id/retry', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ costAccepted: context.singleUserMode ? z.boolean().optional() : z.literal(true), riskAccepted: z.boolean().default(false) }).parse(request.body ?? {});
    return transaction(context.db, async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [request.user.id]);
      const job = (await client.query('SELECT * FROM jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, request.user.id])).rows[0];
      if (!job) throw new AppError(404, '步骤不存在');
      if (!['failed', 'invalid', 'unknown'].includes(job.status)) throw new AppError(409, '只有失败或待确认的步骤可以重试');
      if (!context.singleUserMode && job.attempts >= 3) throw new AppError(409, '本步骤已尝试三次，请检查配置或另存任务后再试');
      await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [job.task_id]);
      if (job.kind === 'image') await assertImageRevision(client, job.task_id, job.payload);
      else if ((await client.query('SELECT id FROM results WHERE task_id=$1', [job.task_id])).rowCount) throw new AppError(409, '本任务已有人工作成的结果版本，请另存任务重新生成');
      if (context.singleUserMode && (await client.query("SELECT id FROM jobs WHERE task_id=$1 AND id<>$2 AND kind=$3 AND status IN ('queued','running') AND ($3='text' OR (payload->>'resultId'=$4 AND payload->>'kind'=$5 AND coalesce(payload->>'batch','')=$6 AND ($5<>'angle' OR payload->>'name'=$7)))", [job.task_id, id, job.kind, job.payload.resultId ?? null, job.payload.kind ?? null, String(job.payload.batch ?? ''), job.payload.name ?? null])).rowCount) throw new AppError(409, '这一步已有进行中的请求，请等待处理完成');
      if (!context.singleUserMode && job.status === 'unknown' && !input.riskAccepted) throw new AppError(409, '上游结果待确认，再次请求可能重复产生费用，需明确接受风险');
      if (!context.singleUserMode && job.kind === 'image' && job.status === 'invalid' && !input.riskAccepted) throw new AppError(409, '图片可能已在上游生成并计费，重试会重新生成，请明确确认重复生成费用');
      let provider;
      try { provider = await automaticProvider(context, job.kind, job.payload, client); } catch (error) { throw new AppError(409, (error as Error).message); }
      if (!context.singleUserMode && job.status === 'unknown') {
        await client.query('UPDATE quotas SET reserved=reserved-1,used=used+1 WHERE user_id=$1 AND kind=$2', [request.user.id, job.kind]);
        await client.query("INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,'unknown_budget_retained',1)", [request.user.id, id, job.kind]);
      }
      if (!context.singleUserMode) await reserve(client, request.user.id, job.kind);
      await client.query("UPDATE jobs SET status='queued',provider=$1,sent_at=NULL,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$2", [provider, id]);
      if (!context.singleUserMode) await client.query("INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,'retry_reserve',1)", [request.user.id, id, job.kind]);
      await client.query("UPDATE tasks SET status='queued' WHERE id=$1", [job.task_id]);
      return { id, status: 'queued' };
    });
  });
  app.get('/api/jobs/:id/raw', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = (await context.db.query('SELECT a.raw_output FROM attempts a JOIN jobs j ON a.job_id=j.id WHERE j.id=$1 AND j.owner_id=$2 ORDER BY a.number DESC LIMIT 1', [id, request.user.id])).rows[0];
    if (!result) throw new AppError(404, '步骤不存在');
    return { text: result.raw_output ?? '' };
  });
};
