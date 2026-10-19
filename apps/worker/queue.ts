import { randomUUID } from 'node:crypto';
import type { AppContext } from '../api/context';
import { transaction } from '../../packages/storage/database';
import { generateText } from '../../packages/providers/text';
import { generateImage } from '../../packages/providers/image';
import { ProviderError } from '../../packages/providers/network';
import { SCHEDULER_LOCK_KEY, eligibleProviders, getExecutionSettings, getProviderPool, type ProviderConfig } from '../../packages/providers/config';
import type { PoolClient } from 'pg';
import { validateOutput } from '../../packages/domain/planning';
import { validateReferences } from '../../packages/domain/references';
import { validateProductGroupReferences } from '../../packages/domain/product-groups';
import { saveMedia } from '../../packages/storage/private-files';
import { addResult } from '../api/task-service';
import type { TaskSnapshot, PromptOutput } from '../../packages/contracts';

export interface Job { id: string; task_id: string; owner_id: string; kind: 'text' | 'image'; status: string; payload: Record<string, unknown>; provider: ProviderConfig; attempts: number; lease_token: string; }
// Shared with settings writes so limits cannot change midway through a claim.
export { SCHEDULER_LOCK_KEY } from '../../packages/providers/config';
type ProviderKind = 'text' | 'image';
export function providerIdentity(kind: ProviderKind, provider: Pick<ProviderConfig, 'id'>) {
  return `${kind}:${provider.id || `legacy-${kind}`}`;
}
export function providerConcurrency(provider: Pick<ProviderConfig, 'maxConcurrency'>) {
  return Number.isInteger(provider.maxConcurrency) && provider.maxConcurrency! >= 1
    ? Math.min(provider.maxConcurrency!, 32) : 4;
}
export async function providerActiveCounts(context: AppContext, client?: PoolClient) {
  const rows = (await (client ?? context.db).query(`
    SELECT kind,coalesce(provider->>'id','legacy-'||kind) AS provider_id,count(*)::integer AS count
    FROM jobs WHERE status='running' GROUP BY kind,coalesce(provider->>'id','legacy-'||kind)`)).rows;
  return new Map<string, number>(rows.map(row => [`${row.kind}:${row.provider_id}`, Number(row.count)]));
}
interface QueuedCandidate {
  id: string; kind: ProviderKind; provider: ProviderConfig; payload: Record<string, unknown>; created_cursor: string;
}
export async function claimJob(context: AppContext): Promise<Job | null> {
  return transaction(context.db, async client => {
    // Both job kinds and all worker processes consume the same global budget.
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEDULER_LOCK_KEY]);
    const settings = await getExecutionSettings(context, client);
    const counts = await providerActiveCounts(context, client);
    if ([...counts.values()].reduce((sum, count) => sum + count, 0) >= settings.maxConcurrentJobs) return null;
    const pools = new Map<ProviderKind, ProviderConfig[]>();
    const cursors = new Map<ProviderKind, string | null>();
    let after: { time: string; id: string } | undefined;
    // Page through waiting jobs without holding locks on an entire queue. A full
    // provider or an incompatible image request must not hide runnable later jobs.
    while (true) {
      const candidates = (await client.query<QueuedCandidate>(`
        SELECT j.id,j.kind,j.provider,j.payload,j.created_at::text AS created_cursor
        FROM jobs j JOIN users u ON j.owner_id=u.id
        WHERE j.status='queued' AND j.sent_at IS NULL AND u.active=true
          AND ($1::timestamptz IS NULL OR (j.created_at,j.id)>($1::timestamptz,$2::uuid))
        ORDER BY j.created_at,j.id LIMIT 64`, [after?.time ?? null, after?.id ?? null])).rows;
      if (!candidates.length) return null;
      for (const candidate of candidates) {
        const automatic = candidate.provider.routing === 'auto';
        let possible: ProviderConfig[];
        if (!pools.has(candidate.kind)) pools.set(candidate.kind, await getProviderPool(context, candidate.kind, client));
        if (automatic) {
          if (!cursors.has(candidate.kind)) {
            const cursor = (await client.query('SELECT value FROM settings WHERE key=$1', [`routing-cursor.${candidate.kind}`])).rows[0]?.value;
            cursors.set(candidate.kind, typeof cursor === 'string' ? cursor : null);
          }
          possible = eligibleProviders(pools.get(candidate.kind)!, candidate.kind, Boolean(context.singleUserMode), candidate.payload);
        } else {
          // Existing queued jobs keep their execution snapshot, even if an
          // administrator has subsequently edited or removed the profile.
          possible = eligibleProviders([candidate.provider], candidate.kind, Boolean(context.singleUserMode), candidate.payload);
        }
        const previous = cursors.get(candidate.kind);
        const previousIndex = possible.findIndex(provider => providerIdentity(candidate.kind, provider) === previous);
        const rotated = previousIndex < 0 ? possible : [...possible.slice(previousIndex + 1), ...possible.slice(0, previousIndex + 1)];
        const capacity = (provider: ProviderConfig) => {
          const current = pools.get(candidate.kind)!.find(profile => providerIdentity(candidate.kind, profile) === providerIdentity(candidate.kind, provider));
          return providerConcurrency(current ?? provider);
        };
        const available = rotated.filter(provider => (counts.get(providerIdentity(candidate.kind, provider)) ?? 0) < capacity(provider));
        available.sort((one, two) => (counts.get(providerIdentity(candidate.kind, one)) ?? 0) / capacity(one)
          - (counts.get(providerIdentity(candidate.kind, two)) ?? 0) / capacity(two));
        const chosen = available[0];
        if (!chosen) continue;
        const locked = (await client.query("SELECT id FROM jobs WHERE id=$1 AND status='queued' AND sent_at IS NULL FOR UPDATE SKIP LOCKED", [candidate.id])).rows[0];
        if (!locked) continue;
        const { routing: _routing, ...frozen } = chosen;
        const row = (await client.query(`UPDATE jobs SET status='running',provider=$1,lease_token=$2,
          lease_until=now()+interval '90 seconds',sent_at=NULL,error=NULL,
          payload=jsonb_set(payload,'{_progress}',jsonb_build_object('stage','preparing','updatedAt',clock_timestamp()))
          WHERE id=$3 AND status='queued' AND sent_at IS NULL RETURNING *`, [frozen, randomUUID(), candidate.id])).rows[0];
        if (!row) continue;
        if (automatic) await client.query(`INSERT INTO settings(key,value) VALUES($1,$2)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
          [`routing-cursor.${candidate.kind}`, JSON.stringify(providerIdentity(candidate.kind, chosen))]);
        await client.query("UPDATE tasks SET status='processing' WHERE id=$1", [row.task_id]);
        return row as Job;
      }
      const last = candidates.at(-1)!;
      after = { time: last.created_cursor, id: last.id };
      if (candidates.length < 64) return null;
    }
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
  const progress = async (stage: 'validating' | 'saving') => {
    const changed = await db.query("UPDATE jobs SET payload=jsonb_set(payload,'{_progress}',jsonb_build_object('stage',$1::text,'updatedAt',clock_timestamp())) WHERE id=$2 AND lease_token=$3 AND status='running'", [stage, job.id, job.lease_token]);
    if (!changed.rowCount) throw new ProviderError('unknown', '任务状态已变化，停止保存当前响应');
  };
  const onDispatch = async () => {
    const changed = await db.query("UPDATE jobs SET sent_at=now(),payload=jsonb_set(payload,'{_progress}',jsonb_build_object('stage','waiting','updatedAt',clock_timestamp())) WHERE id=$1 AND lease_token=$2 AND status='running'", [job.id, job.lease_token]);
    if (!changed.rowCount) throw new ProviderError('rejected', '本步骤领取状态已变化，尚未发送请求');
    dispatched = true;
  };
  const heartbeat = setInterval(() => { void db.query("UPDATE jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'", [job.id, job.lease_token]).catch(() => {}); }, 15000);
  heartbeat.unref();
  let result: PromptOutput | undefined; let savedImage: Awaited<ReturnType<typeof saveMedia>> | undefined;
  try {
    if (job.kind === 'text') {
      const raw = testProvider?.text ? (await onDispatch(), await testProvider.text(snapshot)) : await generateText(context, job.owner_id, snapshot, job.provider, onDispatch);
      await progress('validating');
      try { result = validateOutput(raw, snapshot.skills, snapshot.input.voice, snapshot.input.market); validateReferences(result.shots, snapshot.media.map(x => x.id)); validateProductGroupReferences(snapshot, result.shots); }
      catch (error) { throw new ProviderError('invalid', `返回结果需要修正：${(error as Error).message}`, JSON.stringify(raw).slice(0, 150000)); }
    } else {
      const bytes = testProvider?.image ? (await onDispatch(), await testProvider.image(job.payload)) : await generateImage(context, job.owner_id, job.payload, job.provider, onDispatch);
      await progress('validating');
      try { savedImage = await saveMedia(context, job.owner_id, `${String(job.payload.name ?? '参考图')}.png`, bytes); }
      catch { throw new ProviderError('invalid', '图片响应已收到，但无法校验或保存；请检查磁盘与服务返回格式'); }
    }
    await progress('saving');
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
      if (!context.singleUserMode) {
        await client.query('UPDATE quotas SET reserved=reserved-1,used=used+1 WHERE user_id=$1 AND kind=$2', [job.owner_id, job.kind]);
        await client.query("INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,'settled_attempt',1)", [job.owner_id, job.id, job.kind]);
      }
    });
  } catch (error) {
    const failure = error instanceof ProviderError ? error : dispatched ? new ProviderError('unknown', '步骤中断，未收到完整结果，可重试这一步') : new ProviderError('rejected', '本机素材读取或接口准备失败，尚未发送请求。请检查文件和配置');
    const status = failure.classification === 'rejected' ? 'failed' : failure.classification;
    await transaction(db, async client => {
      const changed = await client.query("UPDATE jobs SET status=$1,error=$2,lease_until=NULL WHERE id=$3 AND lease_token=$4 AND status='running' RETURNING id", [status, failure.message, job.id, job.lease_token]);
      if (!changed.rowCount) return;
      await client.query('UPDATE attempts SET status=$1,raw_output=$2,finished_at=now() WHERE id=$3', [status, failure.raw ?? null, attemptId]);
      if (!context.singleUserMode && status !== 'unknown') {
        await client.query('UPDATE quotas SET reserved=reserved-1,used=used+$1 WHERE user_id=$2 AND kind=$3', [status === 'invalid' ? 1 : 0, job.owner_id, job.kind]);
        await client.query('INSERT INTO usage_ledger(user_id,job_id,kind,action,count) VALUES($1,$2,$3,$4,1)', [job.owner_id, job.id, job.kind, status === 'invalid' ? 'invalid_response_attempt' : 'rejected_release']);
      }
      const hasResults = (await client.query('SELECT 1 FROM results WHERE task_id=$1 LIMIT 1', [job.task_id])).rowCount;
      await client.query('UPDATE tasks SET status=$1 WHERE id=$2', [hasResults ? 'partial' : status, job.task_id]);
    });
  } finally { clearInterval(heartbeat); }
}
