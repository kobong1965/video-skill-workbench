import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import type { AppContext } from '../../apps/api/context';
import { AppError } from '../../apps/api/context';
import { ownedMedia } from '../storage/private-files';
import type { CanvasImportInfo, CanvasImportStep } from './contracts';
import { videoReferenceMode, type CanvasPlan } from './planner';
import { canvasError, canvasTempRoot, type CanvasCli } from './cli';
import { canvasPromptsEqual } from './prompt';
import { planCanvasLayout } from './layout';

export interface ImportRow {
  id: string; owner_id: string; task_id: string; result_id: string; status: CanvasImportInfo['status'];
  project_id: string | null; new_project_name: string | null; plan: CanvasPlan; steps: CanvasImportStep[];
  error: string | null; created_at: string; updated_at: string;
}
export function importInfo(row: ImportRow): CanvasImportInfo {
  return { id: row.id, taskId: row.task_id, resultId: row.result_id, status: row.status,
    progress: row.status === 'succeeded' ? 100 : Math.floor(row.steps.filter(x => x.status === 'succeeded').length / Math.max(1, row.steps.length) * 100),
    projectId: row.project_id, projectUrl: row.project_id ? `https://www.liblib.tv/canvas?projectId=${encodeURIComponent(row.project_id)}` : null,
    error: row.error, steps: row.steps, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function importSteps(plan: CanvasPlan): CanvasImportStep[] {
  return [{ key: 'canvas', label: '连接画布', status: 'pending' },
    ...plan.materials.map(x => ({ key: `media:${x.id}`, label: `上传${x.name}`, status: 'pending' as const })),
    ...plan.batches.flatMap(batch => [...batch.texts.map((x, i) => ({ key: `text:${batch.number}:${i}`, label: `导入第${batch.number}批提示词${i + 1}`, status: 'pending' as const })),
      { key: `video:${batch.number}`, label: `连接第${batch.number}批视频节点`, status: 'pending' as const }]),
    ...(plan.groups ?? []).map(group => ({ key: `group:${group.key}`, label: `整理分组：${group.name}`, status: 'pending' as const })),
    { key: 'verify', label: '核对工作流', status: 'pending' }];
}
const object = (value: unknown) => value as Record<string, any>;

/** Existing LibTV nodes report canvas geometry outside `data`. Unknown sizes are
 * conservatively reserved; missing coordinates must never silently reuse zero. */
export function canvasImportOrigin(nodes: Record<string, any>[]): { x: number; y: number } {
  if (!nodes.length) return { x: 0, y: 0 };
  const byId = new Map(nodes.map(node => [node.id, node]));
  const absoluteX = (node: Record<string, any>, ancestors = new Set<string>()): number => {
    const x = node.position?.x ?? node.x;
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('无法读取现有画布节点位置，已停止导入以免覆盖原工作流');
    if (!node.parentId) return x;
    if (ancestors.has(node.id) || !byId.has(node.parentId)) throw new Error('无法读取现有画布分组位置，已停止导入以免覆盖原工作流');
    return x + absoluteX(byId.get(node.parentId)!, new Set([...ancestors, node.id]));
  };
  let right = -Infinity;
  for (const node of nodes) {
    const x = absoluteX(node);
    const width = node.width ?? node.measured?.width;
    right = Math.max(right, x + (typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1000));
  }
  return { x: Math.max(0, right + 500), y: 0 };
}

/** Serial writes keep graph saves consistent. Every step is persisted before moving on. */
export class CanvasImportRunner {
  private chain: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private controller = new AbortController();
  constructor(private context: AppContext, private cli: CanvasCli) {}
  async recover() {
    await this.context.db.query("UPDATE canvas_imports SET status='unknown',error='应用已重启，点击继续导入以核对并续传工作流',updated_at=now() WHERE status IN ('queued','running')");
  }
  enqueue(id: string) {
    if (this.stopping) throw new AppError(503, '画布后台正在关闭，请稍后重新打开工作台');
    this.chain = this.chain.then(() => this.run(id)).catch(error => console.error('[canvas-import]', canvasError(error)));
  }
  async close() {
    // app.close() has stopped HTTP intake. Finish every already accepted import;
    // abort/recover is for crashes, not a normal close during a remote write.
    this.stopping = true;
    await this.chain;
  }
  private async run(id: string) {
    const db = this.context.db;
    const row = (await db.query("UPDATE canvas_imports SET status='running',error=null,updated_at=now() WHERE id=$1 AND status='queued' RETURNING *", [id])).rows[0] as ImportRow | undefined;
    if (!row) return;
    const completedSteps = new Set(row.steps.filter(x => x.status === 'succeeded').map(x => x.key));
    const execute = async (args: string[]) => object(await this.cli.execute(args, this.controller.signal));
    const step = async (key: string, action: () => Promise<string | void>) => {
      const item = row.steps.find(x => x.key === key)!;
      item.status = 'running'; await persist();
      const nodeKey = await action();
      item.status = 'succeeded'; if (nodeKey) item.nodeKey = nodeKey;
      await persist();
    };
    const persist = () => db.query('UPDATE canvas_imports SET project_id=$2,steps=$3,plan=$4,updated_at=now() WHERE id=$1', [row.id, row.project_id, JSON.stringify(row.steps), JSON.stringify(row.plan)]);
    try {
      await step('canvas', async () => {
        if (!row.project_id) {
          // A previous create may have reached LibTV before the response was interrupted.
          let projects: Record<string, any>[] = []; let page = 1;
          do {
            const found = await execute(['project', 'list', '--name', row.new_project_name!, '--page', String(page), '--page-size', '100']);
            projects.push(...(found.projectMetaList ?? []));
            if (projects.length >= Number(found.total ?? 0) || !(found.projectMetaList?.length)) break;
            page++;
          } while (page <= 20);
          const exact = projects.filter(x => x.name === row.new_project_name);
          if (exact.length > 1) throw new Error('存在多张同名导入画布，请选择具体画布后再导入');
          const created = exact[0] ?? await execute(['project', 'create', row.new_project_name!]);
          let projectId = created.uuid ?? created.projectUuid;
          if (!projectId) {
            // CLI releases wrap creation metadata differently; the canonical list is stable.
            const readback = await execute(['project', 'list', '--name', row.new_project_name!, '--page', '1', '--page-size', '100']);
            const matched = (readback.projectMetaList ?? []).filter((x: { name: string }) => x.name === row.new_project_name);
            if (matched.length !== 1) throw new Error('新建画布已提交，暂未确认编号；请继续导入核对同一画布');
            projectId = matched[0].uuid;
          }
          if (typeof projectId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(projectId)) throw new Error('LibTV 未返回可识别的画布编号');
          row.project_id = projectId; await persist();
        }
        await execute(['project', row.project_id]);
      });
      const project = row.project_id!;
      const layout = row.plan.groups?.length ? planCanvasLayout(row.plan) : null;
      if (layout && !row.plan.origin) {
        const graph = await execute(['project', project]);
        row.plan.origin = canvasImportOrigin(graph.nodes ?? []);
        // Persist the reserved origin before any upload; a retry reuses the same region.
        await persist();
      }
      const point = (key: string, x: number, y: number) => {
        const rect = layout?.positions[key];
        return rect ? { x: rect.x + row.plan.origin!.x, y: rect.y + row.plan.origin!.y } : { x, y };
      };
      const listed = await execute(['node', 'list', '-p', project]);
      const existing = (listed.nodes ?? []) as { id: string; name: string }[];
      const createdIds = new Map<string, string>();
      const expectedEdges: { source: string; target: string }[] = [];
      const logicalIds = new Map<string, string>();
      const groupIds = new Map<string, string>();
      const findNode = (name: string) => {
        const matched = existing.filter(x => x.name === name);
        if (matched.length > 1) throw new Error(`导入节点重名：${name}`);
        return matched[0]?.id;
      };
      const saveNode = async (name: string, args: string[]) => {
        const known = findNode(name);
        if (known) return known;
        const saved = await execute(args); const nodeKey = saved.nodeKey ?? saved.newNodeKey;
        if (typeof nodeKey !== 'string' || !nodeKey) throw new Error(`LibTV 未返回节点编号：${name}`);
        existing.push({ name, id: nodeKey }); return nodeKey;
      };
      const mediaRoot = path.join(canvasTempRoot, row.id);
      await mkdir(mediaRoot, { recursive: true });
      for (const [index, media] of row.plan.materials.entries()) {
        await step(`media:${media.id}`, async () => {
          let nodeKey = findNode(media.name);
          if (!nodeKey) {
            const sourceId = media.sourceId ?? media.id;
            const file = media.kind === 'benchmark'
              ? (await db.query(`SELECT m.* FROM media m WHERE m.id=$1 AND EXISTS (SELECT 1 FROM skill_files f JOIN skill_versions v ON v.id=f.version_id JOIN skills s ON s.id=v.skill_id WHERE f.media_id=m.id AND v.id=ANY($2::uuid[]) AND (s.owner_id=$3 OR s.visibility='public'))`, [sourceId, media.skillVersionIds ?? [], row.owner_id])).rows[0]
              : await ownedMedia(this.context, sourceId, row.owner_id);
            if (!file) throw new Error('所选 Skill 的原对标视频不存在或已无权访问');
            const original = path.resolve(this.context.dataRoot, file.disk_path);
            if (!original.startsWith(path.resolve(this.context.dataRoot) + path.sep)) throw new Error('素材路径无效');
            const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4' } as Record<string, string>)[file.mime];
            if (!extension || (file.mime === 'video/mp4' && media.kind !== 'benchmark')) throw new Error('画布导入只接受产品图片、已确认图片资产及 Skill 明确要求的原对标视频');
            const staged = path.join(mediaRoot, `${sourceId}${extension}`);
            await copyFile(original, staged);
            const position = point(media.id, 0, index * 650);
            nodeKey = await saveNode(media.name, ['upload', media.name, '-p', project, '-t', file.mime === 'video/mp4' ? 'video' : 'image', '-f', staged, '--x', String(position.x), '--y', String(position.y)]);
          }
          createdIds.set(media.id, nodeKey); logicalIds.set(media.id, nodeKey); return nodeKey;
        });
      }
      const videoIds: string[] = [];
      const modelSchemas = new Map<string, Record<string, any>>();
      for (const batch of row.plan.batches) {
        const textIds: string[] = []; const y = (batch.number - 1) * 1200;
        for (const [index, text] of batch.texts.entries()) await step(`text:${batch.number}:${index}`, async () => {
          const content = `content=${JSON.stringify([text.content])}`;
          const position = point(text.name, 600, y + index * 450);
          const nodeKey = await saveNode(text.name, ['node', '--x', String(position.x), '--y', String(position.y), 'create', text.name, '-p', project, '-t', 'text', '-u', content]);
          const saved = await execute(['node', nodeKey, '-p', project]);
          if (JSON.stringify(saved.data?.content) !== JSON.stringify([text.content])) throw new Error('画布提示词已修改，已保留现有内容；请另建工作流或恢复原文后继续');
          textIds.push(nodeKey); logicalIds.set(text.name, nodeKey); return nodeKey;
        });
        await step(`video:${batch.number}`, async () => {
          const parents = [...batch.materialIds.map(id => createdIds.get(id)!), ...textIds];
          const links = parents.flatMap(id => ['--left', id]);
          const position = point(batch.video.name, 1350, y);
          const nodeKey = await saveNode(batch.video.name, ['node', '--x', String(position.x), '--y', String(position.y), 'create', batch.video.name, '-p', project, '-t', 'video', '--prompt', batch.video.prompt]);
          const current = await execute(['node', nodeKey, '-p', project]);
          if (current.data?.taskInfo?.taskId || current.data?.url?.length) throw new Error('画布视频节点已有生成任务或结果，已保留现有内容；请另建工作流');
          if (!canvasPromptsEqual(batch.video.prompt, current.data?.params?.prompt)) throw new Error('画布视频提示词已修改，已保留现有内容；请另建工作流或恢复原文后继续');
          expectedEdges.push(...parents.map(source => ({ source, target: nodeKey })));
          videoIds.push(nodeKey);
          logicalIds.set(batch.video.name, nodeKey);
          if (completedSteps.has(`video:${batch.number}`)) return nodeKey;
          const model = current.data?.params?.model;
          if (typeof model !== 'string' || !model) throw new Error('LibTV 默认视频模型尚未就绪，请在画布确认模型后继续导入');
          let schema = modelSchemas.get(model);
          if (!schema) { schema = (await execute(['model', model])).schema; modelSchemas.set(model, schema!); }
          if (!schema) throw new Error('无法读取画布默认模型的参考素材能力');
          const refs = row.plan.materials.filter(x => batch.materialIds.includes(x.id));
          const mode = videoReferenceMode(schema, refs.filter(x => x.mime.startsWith('image/')).length, refs.filter(x => x.mime === 'video/mp4').length);
          await execute(['node', nodeKey, '-p', project, '--prompt', batch.video.prompt, '-s', `modeType=${mode}`, ...links]);
          return nodeKey;
        });
      }
      for (const group of layout?.groups ?? []) {
        await step(`group:${group.key}`, async () => {
          const children = group.nodeKeys.map(key => {
            const id = logicalIds.get(key);
            if (!id) throw new Error('脚本分组缺少已保存的节点');
            return id;
          });
          const recordedId = row.steps.find(item => item.key === `group:${group.key}`)?.nodeKey;
          if (recordedId && !existing.some(node => node.id === recordedId)) throw new Error('已保存的脚本分组不存在，已保留画布现状，请核对后再导入');
          let nodeKey = recordedId ?? findNode(group.name);
          // A saved group is read back on retries. Do not reparent nodes that
          // the user may have moved to another group after the original import.
          const saved = await execute(nodeKey
            ? ['group', nodeKey, '-p', project]
            : ['group', 'create', group.name, '-p', project, ...children.flatMap(id => ['--node', id])]);
          nodeKey ??= saved.groupNodeKey;
          if (!nodeKey) throw new Error('LibTV 未返回脚本分组编号');
          if (!findNode(group.name)) existing.push({ id: nodeKey, name: group.name });
          groupIds.set(group.key, nodeKey);
          return nodeKey;
        });
      }
      await step('verify', async () => {
        const graph = await execute(['project', project]);
        const nodes = new Set((graph.nodes ?? []).map((x: { id: string }) => x.id));
        if (row.steps.some(x => x.nodeKey && !nodes.has(x.nodeKey))) throw new Error('工作流节点尚未完整保存，可继续导入核对');
        if (expectedEdges.some(expected => !(graph.edges ?? []).some((edge: { source: string; target: string }) => edge.source === expected.source && edge.target === expected.target))) throw new Error('参考图或提示词连线尚未完整保存，可继续导入核对');
        for (const group of layout?.groups ?? []) {
          const saved = await execute(['group', groupIds.get(group.key)!, '-p', project]);
          const children = saved.data?.childNodeIds ?? saved.childNodeIds ?? saved.boundNodeKeys;
          if (!Array.isArray(children) || group.nodeKeys.some(key => !children.includes(logicalIds.get(key)))) throw new Error('脚本分组成员尚未完整保存，可继续导入核对');
        }
        for (const nodeKey of videoIds) {
          const saved = await execute(['node', nodeKey, '-p', project]);
          if (saved.data?.taskInfo?.taskId || saved.data?.url?.length) throw new Error('视频节点已有生成任务或结果，请在画布核对');
        }
      });
      await db.query("UPDATE canvas_imports SET status='succeeded',error=null,updated_at=now() WHERE id=$1", [row.id]);
    } catch (error) {
      await db.query('UPDATE canvas_imports SET status=$2,error=$3,updated_at=now() WHERE id=$1', [row.id, this.stopping ? 'unknown' : 'failed', canvasError(error)]);
    }
  }
}
