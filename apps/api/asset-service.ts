import type { AppContext } from './context';
import { AppError } from './context';
import { batchShots } from '../../packages/domain/planning';
import type { PromptOutput, TaskSnapshot } from '../../packages/contracts';
import type { PoolClient } from 'pg';

export interface BoundAsset {
  id: string; name: string; kind: string; mediaId: string; resultId: string | null; parentId: string | null;
  batch: number | null; dependencies: string[]; stale: boolean;
}
export async function boundAssets(context: AppContext, taskId: string, resultId: string, client: Pick<PoolClient, 'query'> = context.db) {
  const rows = (await client.query(`SELECT DISTINCT ON (b.kind,coalesce(b.batch,0),CASE WHEN b.kind='angle' THEN a.id END) a.id,a.name,b.kind,a.media_id AS "mediaId",a.result_id AS "resultId",coalesce(b.parent_id,a.parent_id) AS "parentId",b.batch,coalesce(b.dependencies,a.dependencies) AS dependencies FROM asset_bindings b JOIN assets a ON b.asset_id=a.id WHERE b.task_id=$1 AND b.result_id=$2 AND a.confirmed=true ORDER BY b.kind,coalesce(b.batch,0),CASE WHEN b.kind='angle' THEN a.id END,b.created_at DESC,b.id DESC`, [taskId, resultId])).rows as BoundAsset[];
  const activeMasters = new Set(rows.filter(x => ['person', 'scene'].includes(x.kind)).map(x => x.id));
  return rows.map(row => ({ ...row, stale: (row.kind === 'angle' && Boolean(row.parentId) && !activeMasters.has(row.parentId!)) || (row.kind === 'storyboard' && row.dependencies.some(id => !activeMasters.has(id))) }));
}
export async function confirmedResult(context: AppContext, taskId: string, resultId: string) {
  const row = (await context.db.query('SELECT id,output,confirmed FROM results WHERE id=$1 AND task_id=$2', [resultId, taskId])).rows[0];
  if (!row || !row.confirmed) throw new AppError(409, '请先确认本次脚本结果');
  const latest = (await context.db.query('SELECT id FROM results WHERE task_id=$1 ORDER BY number DESC LIMIT 1', [taskId])).rows[0];
  if (latest.id !== resultId) throw new AppError(409, '请使用最新脚本版本；旧版内容仍可查看和下载');
  return row as { id: string; output: PromptOutput; confirmed: boolean };
}
export function missingAssets(snapshot: TaskSnapshot, output: PromptOutput, assets: BoundAsset[]) {
  const missing: string[] = [];
  const available = assets.filter(x => !x.stale);
  if (snapshot.input.generatePerson && !available.some(x => x.kind === 'person')) missing.push('已确认的人物主参考');
  if (snapshot.input.generateScene && !available.some(x => x.kind === 'scene')) missing.push('已确认的场景参考');
  const batches = batchShots(output.shots, snapshot.capability);
  if (batches.length > 1) for (const batch of batches) if (!available.some(x => x.kind === 'storyboard' && x.batch === batch.number)) missing.push(`第 ${batch.number} 批已确认故事面板`);
  return missing;
}
