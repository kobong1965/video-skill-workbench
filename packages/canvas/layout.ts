import type { CanvasGroup, CanvasPlan } from './planner';

export interface CanvasRect { x: number; y: number; width: number; height: number; }
export interface CanvasLayout {
  /** Material IDs and text/video names are logical keys, not remote node IDs. */
  positions: Record<string, CanvasRect>;
  groups: { key: string; name: string; nodeKeys: string[]; bounds: CanvasRect }[];
  bounds: CanvasRect;
}

const padding = 120;
const header = 100;
const columnGap = 180;
const nodeGap = 100;
const batchGap = 240;
const groupGap = 500;
const mediaSize = { width: 400, height: 600 };
const textWidth = 650;
const videoSize = { width: 650, height: 600 };

// Text nodes are not all equally short. Reserve enough vertical space for
// explicit lines and wrapped Chinese/English content without truncating it.
function textHeight(content: string) {
  const columns = Math.floor((textWidth - 48) / 8);
  const lines = content.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(Array.from(line).reduce((width, char) => width + (char.codePointAt(0)! > 255 ? 2 : 1), 0) / columns)), 0);
  return Math.max(600, 100 + lines * 24);
}

/** Local deterministic layout; the caller persists one offset for the import. */
export function planCanvasLayout(plan: CanvasPlan): CanvasLayout {
  const positions: Record<string, CanvasRect> = {};
  const groups: CanvasLayout['groups'] = [];
  const sourceGroups: CanvasGroup[] = plan.groups?.length ? plan.groups : [{
    key: 'legacy', name: '导入脚本', materialIds: plan.materials.map(material => material.id), batchNumbers: plan.batches.map(batch => batch.number),
  }];
  const materialIds = new Set(plan.materials.map(material => material.id));
  const assignedBatches = new Set<number>();
  let groupY = 0;
  for (const group of sourceGroups) {
    const allowed = new Set(group.materialIds);
    if (group.materialIds.some(id => !materialIds.has(id))) throw new Error('脚本分组包含不存在的素材');
    const batches = plan.batches.filter(batch => group.batchNumbers.includes(batch.number));
    if (batches.some(batch => assignedBatches.has(batch.number))) throw new Error('同一批次不能属于多个脚本分组');
    if (batches.some(batch => batch.materialIds.some(id => !allowed.has(id)))) throw new Error('跨脚本素材连线，请为每个脚本保留独立素材节点');
    for (const batch of batches) assignedBatches.add(batch.number);
    const referenced = new Set(batches.flatMap(batch => batch.materialIds));
    const unused = group.materialIds.filter(id => !referenced.has(id));
    const maxLaneMaterials = Math.max(0, ...batches.map((batch, index) => batch.materialIds.length + (index === 0 ? unused.length : 0)), batches.length ? 0 : unused.length);
    const columns = Math.min(3, maxLaneMaterials);
    const materialWidth = columns ? columns * mediaSize.width + (columns - 1) * nodeGap : 0;
    const textX = padding + (columns ? materialWidth + columnGap : 0);
    const videoX = textX + textWidth + columnGap;
    let laneY = groupY + header + padding;
    const nodeKeys: string[] = [];
    const placedMaterials = new Set<string>();
    const place = (key: string, rect: CanvasRect) => {
      if (positions[key]) throw new Error('脚本分组节点重复，请使用独立节点名称');
      positions[key] = rect; nodeKeys.push(key);
    };
    const placeMaterials = (ids: string[], y: number) => {
      const fresh = [...new Set(ids)].filter(id => !placedMaterials.has(id));
      for (const [index, id] of fresh.entries()) {
        place(id, { x: padding + (index % columns) * (mediaSize.width + nodeGap), y: y + Math.floor(index / columns) * (mediaSize.height + nodeGap), ...mediaSize });
        placedMaterials.add(id);
      }
      return fresh.length ? Math.ceil(fresh.length / columns) * (mediaSize.height + nodeGap) - nodeGap : 0;
    };
    for (const [index, batch] of batches.entries()) {
      const freshHeight = placeMaterials([...batch.materialIds, ...(index === 0 ? unused : [])], laneY);
      let textY = laneY;
      for (const text of batch.texts) {
        const height = textHeight(text.content);
        place(text.name, { x: textX, y: textY, width: textWidth, height });
        textY += height + nodeGap;
      }
      place(batch.video.name, { x: videoX, y: laneY, ...videoSize });
      // Shared materials remain in the same script group; every batch still
      // reserves a full lane for its own text/video and reference count.
      const referenceHeight = batch.materialIds.length && columns ? Math.ceil(batch.materialIds.length / columns) * (mediaSize.height + nodeGap) - nodeGap : 0;
      const height = Math.max(freshHeight, referenceHeight, textY - laneY - (batch.texts.length ? nodeGap : 0), videoSize.height);
      laneY += height + batchGap;
    }
    if (!batches.length) laneY += placeMaterials(unused, laneY);
    const bottom = Math.max(groupY + header + padding, ...nodeKeys.map(key => positions[key].y + positions[key].height));
    const right = Math.max(padding, ...nodeKeys.map(key => positions[key].x + positions[key].width));
    const bounds = { x: 0, y: groupY, width: right + padding, height: bottom - groupY + padding };
    groups.push({ key: group.key, name: group.name, nodeKeys, bounds });
    groupY += bounds.height + groupGap;
  }
  if (assignedBatches.size !== plan.batches.length) throw new Error('脚本分组遗漏视频批次');
  const bounds = { x: 0, y: 0, width: Math.max(0, ...groups.map(group => group.bounds.width)), height: Math.max(0, ...groups.map(group => group.bounds.y + group.bounds.height)) };
  return { positions, groups, bounds };
}
