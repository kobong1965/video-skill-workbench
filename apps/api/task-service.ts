import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AppContext } from './context';
import { AppError } from './context';
import { transaction } from '../../packages/storage/database';
import { automaticProvider } from '../../packages/providers/config';
import type { TaskSnapshot, PromptOutput } from '../../packages/contracts';

export async function taskRow(context: AppContext, id: string, ownerId: string) {
  const row = (await context.db.query('SELECT * FROM tasks WHERE id=$1 AND owner_id=$2', [id, ownerId])).rows[0];
  if (!row) throw new AppError(404, '任务不存在或无权访问');
  return row as { id: string; owner_id: string; snapshot: TaskSnapshot; name: string; status: string; created_at: string };
}
export async function reserve(client: PoolClient, ownerId: string, kind: string) {
  await client.query('INSERT INTO quotas(user_id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING', [ownerId, kind]);
  const updated = await client.query('UPDATE quotas SET reserved=reserved+1 WHERE user_id=$1 AND kind=$2 AND used+reserved<allowance RETURNING *', [ownerId, kind]);
  if (!updated.rowCount) throw new AppError(409, '本账号可用额度不足，请管理员调整额度');
}
export async function assertImageRevision(client: PoolClient, taskId: string, payload: Record<string, unknown>) {
  const latest = (await client.query('SELECT id,confirmed FROM results WHERE task_id=$1 ORDER BY number DESC LIMIT 1', [taskId])).rows[0];
  if (!latest || latest.id !== payload.resultId || !latest.confirmed) throw new AppError(409, '图片引用的脚本版本已改变或尚未确认，请在最新版本中重新选择');
}
export async function enqueue(context: AppContext, ownerId: string, taskId: string, kind: 'text' | 'image', key: string, payload: Record<string, unknown> = {}) {
  let config;
  try { config = await automaticProvider(context, kind, payload); } catch (error) { throw new AppError(409, (error as Error).message); }
  return transaction(context.db, async client => {
    const owner = (await client.query('SELECT active FROM users WHERE id=$1 FOR UPDATE', [ownerId])).rows[0];
    if (!owner?.active) throw new AppError(403, '账号已停用');
    const previous = (await client.query('SELECT id,task_id,kind,status FROM jobs WHERE owner_id=$1 AND submit_key=$2', [ownerId, key])).rows[0];
    if (previous) {
      if (previous.task_id !== taskId || previous.kind !== kind) throw new AppError(409, '提交标识已用于另一个操作');
      return { id: previous.id, status: previous.status };
    }
    await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [taskId]);
    if (kind === 'text') {
      if ((await client.query("SELECT id FROM jobs WHERE task_id=$1 AND kind='text' AND (status IN ('queued','running') OR (status='unknown' AND NOT $2::boolean))", [taskId, Boolean(context.singleUserMode)])).rowCount) throw new AppError(409, '本任务已有进行中的请求，请等待处理完成');
      if ((await client.query('SELECT id FROM results WHERE task_id=$1', [taskId])).rowCount) throw new AppError(409, '本任务已有结果；需要重新创作请另存新任务');
    } else {
      await assertImageRevision(client, taskId, payload);
      const pending = (await client.query("SELECT id FROM jobs WHERE task_id=$1 AND kind='image' AND (status IN ('queued','running') OR (status='unknown' AND NOT $6::boolean)) AND payload->>'resultId'=$2 AND payload->>'kind'=$3 AND coalesce(payload->>'batch','')=$4 AND ($3<>'angle' OR payload->>'name'=$5)", [taskId, payload.resultId, payload.kind, String(payload.batch ?? ''), payload.name, Boolean(context.singleUserMode)])).rowCount;
      if (pending) throw new AppError(409, '这一图片步骤已有进行中或待确认的请求，请先处理现有请求');
    }
    if (!context.singleUserMode) await reserve(client, ownerId, kind);
    const id = randomUUID();
    await client.query('INSERT INTO jobs(id,task_id,owner_id,kind,submit_key,provider,payload) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, taskId, ownerId, kind, key, config, payload]);
    if (!context.singleUserMode) await client.query('INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,\'reserve\',1)', [ownerId, id, kind]);
    await client.query("UPDATE tasks SET status='queued' WHERE id=$1", [taskId]);
    return { id, status: 'queued' };
  });
}
export async function addResult(client: PoolClient, taskId: string, output: PromptOutput) {
  await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [taskId]);
  const number = Number((await client.query('SELECT coalesce(max(number),0)+1 AS number FROM results WHERE task_id=$1', [taskId])).rows[0].number);
  const id = randomUUID();
  await client.query('INSERT INTO results(id,task_id,number,output) VALUES($1,$2,$3,$4)', [id, taskId, number, output]);
  await client.query("UPDATE tasks SET status='awaiting_confirmation' WHERE id=$1", [taskId]);
  return { id, number };
}
