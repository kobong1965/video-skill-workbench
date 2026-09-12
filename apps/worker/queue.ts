import { randomUUID } from 'node:crypto';
import type { AppContext } from '../api/context';
import { transaction } from '../../packages/storage/database';
import { generateText } from '../../packages/providers/text';
import { generateImage } from '../../packages/providers/image';
import { ProviderError } from '../../packages/providers/network';
import type { ProviderConfig } from '../../packages/providers/config';
import { validateOutput } from '../../packages/domain/planning';
import { validateReferences } from '../../packages/domain/references';
import { saveMedia } from '../../packages/storage/private-files';
import { addResult } from '../api/task-service';
import type { TaskSnapshot, PromptOutput } from '../../packages/contracts';

export interface Job { id: string; task_id: string; owner_id: string; kind: 'text' | 'image'; status: string; payload: Record<string, unknown>; provider: ProviderConfig; attempts: number; lease_token: string; }
export async function claimJob(context: AppContext): Promise<Job | null> {
  return transaction(context.db, async client => {
    const candidate = (await client.query("SELECT j.id FROM jobs j JOIN users u ON j.owner_id=u.id WHERE j.status='queued' AND u.active=true ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1")).rows[0];
    if (!candidate) return null;
    const row = (await client.query("UPDATE jobs SET status='running',lease_token=$1,lease_until=now()+interval '90 seconds',sent_at=NULL,error=NULL WHERE id=$2 RETURNING *", [randomUUID(), candidate.id])).rows[0];
    await client.query("UPDATE tasks SET status='processing' WHERE id=$1", [row.task_id]);
    return row as Job;
  });
}
export async function recoverExpiredJobs(context: AppContext) {
  await transaction(context.db, async client => {
    const expired = (await client.query("SELECT * FROM jobs WHERE status='running' AND lease_until<now() FOR UPDATE SKIP LOCKED")).rows;
    for (const job of expired) {
      const status = job.sent_at ? 'unknown' : 'queued';
      await client.query('UPDATE jobs SET status=$1,lease_token=NULL,lease_until=NULL,error=$2 WHERE id=$3', [status, job.sent_at ? '后台中断，上游结果待确认；不会自动重发' : null, job.id]);
      await client.query("UPDATE attempts SET status=$1,finished_at=now() WHERE job_id=$2 AND status='running'", [job.sent_at ? 'unknown' : 'local_interrupted', job.id]);
      await client.query('UPDATE tasks SET status=$1 WHERE id=$2', [status, job.task_id]);
    }
  });
}
export interface TestProvider { text?: (snapshot: TaskSnapshot) => Promise<unknown>; image?: (payload: Record<string, unknown>) => Promise<Buffer>; }
export async function runJob(context: AppContext, job: Job, testProvider?: TestProvider) {
  const { db } = context;
  const task = (await db.query('SELECT snapshot FROM tasks WHERE id=$1', [job.task_id])).rows[0];
  const snapshot = task.snapshot as TaskSnapshot;
  const attemptId = randomUUID();
  const ready = await transaction(db, async client => {
    const row = (await client.query("UPDATE jobs SET attempts=attempts+1 WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING attempts", [job.id, job.lease_token])).rows[0];
    if (!row) return false;
    await client.query("INSERT INTO attempts(id,job_id,number,status,provider) VALUES($1,$2,$3,'running',$4)", [attemptId, job.id, row.attempts, job.provider]);
    return true;
  });
  if (!ready) return;
  let dispatched = false;
  const onDispatch = async () => {
    const changed = await db.query("UPDATE jobs SET sent_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'", [job.id, job.lease_token]);
    if (!changed.rowCount) throw new ProviderError('rejected', '本步骤领取状态已变化，尚未发送请求');
    dispatched = true;
  };
  const heartbeat = setInterval(() => { void db.query("UPDATE jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'", [job.id, job.lease_token]).catch(() => {}); }, 15000);
  heartbeat.unref();
  let result: PromptOutput | undefined; let savedImage: Awaited<ReturnType<typeof saveMedia>> | undefined;
  try {
    if (job.kind === 'text') {
      const raw = testProvider?.text ? (await onDispatch(), await testProvider.text(snapshot)) : await generateText(context, job.owner_id, snapshot, job.provider, onDispatch);
      try { result = validateOutput(raw, snapshot.skills, snapshot.input.voice, snapshot.input.market); validateReferences(result.shots, snapshot.media.map(x => x.id)); }
      catch (error) { throw new ProviderError('invalid', `返回结果需要修正：${(error as Error).message}`, JSON.stringify(raw).slice(0, 150000)); }
    } else {
      const bytes = testProvider?.image ? (await onDispatch(), await testProvider.image(job.payload)) : await generateImage(context, job.owner_id, job.payload, job.provider, onDispatch);
      try { savedImage = await saveMedia(context, job.owner_id, `${String(job.payload.name ?? '参考图')}.png`, bytes); }
      catch { throw new ProviderError('invalid', '图片响应已收到，但无法校验或保存；请检查磁盘与服务返回格式'); }
    }
    await transaction(db, async client => {
      const active = (await client.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [job.id, job.lease_token])).rows[0];
      if (!active) return;
      if (result) await addResult(client, job.task_id, result);
      if (savedImage) {
        const id = randomUUID();
        await client.query('INSERT INTO assets(id,owner_id,name,kind,media_id,task_id,result_id,parent_id,batch,dependencies) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, job.owner_id, job.payload.name, job.payload.kind, savedImage.id, job.task_id, job.payload.resultId, job.payload.parentId ?? null, job.payload.batch ?? null, JSON.stringify(job.payload.referenceAssetIds ?? [])]);
        await client.query("UPDATE tasks SET status='awaiting_image_confirmation' WHERE id=$1", [job.task_id]);
      }
      await client.query("UPDATE jobs SET status='succeeded',lease_until=NULL,error=NULL WHERE id=$1", [job.id]);
      await client.query("UPDATE attempts SET status='succeeded',finished_at=now() WHERE id=$1", [attemptId]);
      await client.query('UPDATE quotas SET reserved=reserved-1,used=used+1 WHERE user_id=$1 AND kind=$2', [job.owner_id, job.kind]);
      await client.query("INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,'settled_attempt',1)", [job.owner_id, job.id, job.kind]);
    });
  } catch (error) {
    const failure = error instanceof ProviderError ? error : dispatched ? new ProviderError('unknown', '步骤中断，结果待确认，请先核对已有产物') : new ProviderError('rejected', '本机素材读取或接口准备失败，尚未发送请求。请检查文件和配置，本次额度已释放');
    const status = failure.classification === 'rejected' ? 'failed' : failure.classification;
    await transaction(db, async client => {
      const changed = await client.query("UPDATE jobs SET status=$1,error=$2,lease_until=NULL WHERE id=$3 AND lease_token=$4 AND status='running' RETURNING id", [status, failure.message, job.id, job.lease_token]);
      if (!changed.rowCount) return;
      await client.query('UPDATE attempts SET status=$1,raw_output=$2,finished_at=now() WHERE id=$3', [status, failure.raw ?? null, attemptId]);
      if (status !== 'unknown') {
        await client.query('UPDATE quotas SET reserved=reserved-1,used=used+$1 WHERE user_id=$2 AND kind=$3', [status === 'invalid' ? 1 : 0, job.owner_id, job.kind]);
        await client.query('INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,$4,1)', [job.owner_id, job.id, job.kind, status === 'invalid' ? 'invalid_response_attempt' : 'rejected_release']);
      }
      const hasResults = (await client.query('SELECT 1 FROM results WHERE task_id=$1 LIMIT 1', [job.task_id])).rowCount;
      await client.query('UPDATE tasks SET status=$1 WHERE id=$2', [hasResults ? 'partial' : status, job.task_id]);
    });
  } finally { clearInterval(heartbeat); }
}
