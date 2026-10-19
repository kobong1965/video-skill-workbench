import type { PromptOutput, TaskSnapshot } from '../contracts';
import { batchShots, renderPrompt } from '../domain/planning';
import { batchMediaIds, referenceRoleLabels } from '../domain/references';
import { productGroupLabel, productUseLabels, validateProductGroupReferences } from '../domain/product-groups';

export interface CanvasMaterial { id: string; sourceId?: string; name: string; kind: string; mime: string; batch: number | null; skillVersionIds?: string[]; productGroupLabel?: string; }
export interface CanvasGroup { key: string; name: string; materialIds: string[]; batchNumbers: number[]; }
export interface CanvasPlan {
  materials: CanvasMaterial[];
  batches: { number: number; groupKey?: string; materialIds: string[]; texts: { name: string; content: string }[]; video: { name: string; prompt: string } }[];
  groups?: CanvasGroup[];
  origin?: { x: number; y: number };
}

/** Configure the platform-selected model's input mode without selecting or running a model. */
export function videoReferenceMode(schema: Record<string, any>, images: number, videos: number) {
  const modes = schema.properties?.modeType?.items ?? {};
  const choices = videos ? ['mixed2video', ...(images ? [] : ['video2video'])]
    : images === 1 ? ['singleImage2video', 'image2video', 'mixed2video'] : ['image2video', 'mixed2video'];
  for (const mode of choices) {
    const range = modes[mode]; const count = mode === 'mixed2video' ? images + videos : videos || images;
    if (Array.isArray(range) && count >= range[0] && count <= range[1]) return mode;
  }
  throw new Error(`画布当前默认模型不支持本批参考素材（${images} 张图片、${videos} 个视频）；未删减素材或触发生成，请在画布切换能承载的模型后继续导入，或另建任务明确减少参考图`);
}

/** Uses only saved task/result inputs; preview videos and unconfirmed assets never enter the plan. */
export function planCanvasImport(importId: string, snapshot: TaskSnapshot, output: PromptOutput, assets: CanvasMaterial[]): CanvasPlan {
  validateProductGroupReferences(snapshot, output.shots);
  const prefix = `SW-${importId.replaceAll('-', '').slice(0, 12)}`;
  const originals: CanvasMaterial[] = snapshot.media.map(x => ({ id: x.id, name: x.name, mime: x.mime, kind: x.role, batch: null, ...(productGroupLabel(snapshot, x.id) ? { productGroupLabel: productGroupLabel(snapshot, x.id) } : {}) }));
  const merged = new Map<string, CanvasMaterial>();
  for (const material of [...originals, ...assets]) {
    const prior = merged.get(material.id);
    merged.set(material.id, prior ? { ...prior, skillVersionIds: [...new Set([...(prior.skillVersionIds ?? []), ...(material.skillVersionIds ?? [])])] } : material);
  }
  const originalIds = new Set(originals.map(x => x.id));
  // A platform batch must not combine two saved scripts. Keep the validated shot
  // order while giving each script its own copies of shared reference nodes.
  const scripts: { versionId: string; shots: PromptOutput['shots'] }[] = [];
  for (const shot of output.shots) {
    if (scripts.at(-1)?.versionId !== shot.skillVersionId) {
      if (scripts.some(script => script.versionId === shot.skillVersionId)) throw new Error('脚本镜头顺序交错，请先恢复每套脚本连续的镜头顺序');
      scripts.push({ versionId: shot.skillVersionId, shots: [] });
    }
    scripts.at(-1)!.shots.push(shot);
  }
  let nextBatch = 1;
  const scriptBatches = scripts.map(script => batchShots(script.shots, snapshot.capability).map(batch => ({ ...batch, number: nextBatch++ })));
  // Existing confirmed storyboards/tail frames were saved using the original
  // whole-result batching. A changed number is safe only when the exact same
  // complete shot sequence still makes up one new batch.
  const newBatches = scriptBatches.flat();
  const oldToNewBatch = new Map(batchShots(output.shots, snapshot.capability).flatMap(oldBatch => {
    const matching = newBatches.find(batch => batch.shots.length === oldBatch.shots.length && batch.shots.every((shot, index) => shot === oldBatch.shots[index]));
    return matching ? [[oldBatch.number, matching.number] as const] : [];
  }));
  const remappedMaterials = [...merged.values()].map(material => {
    if (originalIds.has(material.id) || material.batch === null) return material;
    const batch = oldToNewBatch.get(material.batch);
    if (batch === undefined) throw new Error('分镜图/尾帧跨脚本，请按脚本重新确认素材');
    return { ...material, batch };
  });
  const plan: CanvasPlan = { materials: [], batches: [], groups: [] };
  for (const [scriptIndex, script] of scripts.entries()) {
    const groupKey = `script:${script.versionId}`;
    const selected = snapshot.skills?.find(skill => skill.versionId === script.versionId);
    const groupName = `${prefix}-脚本${scriptIndex + 1}-${(selected?.name || `脚本${scriptIndex + 1}`).slice(0, 60)}`;
    const batches = scriptBatches[scriptIndex];
    const batchNumbers = new Set(batches.map(batch => batch.number));
    const materials = remappedMaterials
      .filter(material => material.kind === 'benchmark' ? material.skillVersionIds?.includes(script.versionId)
        : originalIds.has(material.id) || material.batch === null || batchNumbers.has(material.batch))
      .map((material, index) => {
        const productGroups = (snapshot.input?.productGroups ?? []).flatMap((group, groupIndex) => group.mediaIds.includes(material.id) ? [`组${groupIndex + 1}-${group.styleNumber.slice(0, 20)}`] : []);
        const materialPrefix = scripts.length > 1 ? `${prefix}-脚本${scriptIndex + 1}` : prefix;
        return { ...material, sourceId: material.sourceId ?? material.id,
          id: scripts.length > 1 ? `${material.id}@script${scriptIndex + 1}` : material.id,
          name: `${materialPrefix}-${productGroups.length ? productGroups.join('+').slice(0, 50) + '-' : ''}素材${String(index + 1).padStart(2, '0')}-${material.name.slice(0, productGroups.length ? 40 : 60)}` };
      });
    plan.materials.push(...materials);
    plan.groups!.push({ key: groupKey, name: groupName, materialIds: materials.map(material => material.id), batchNumbers: batches.map(batch => batch.number) });
    plan.batches.push(...batches.map(batch => {
    const required = batchMediaIds(snapshot, batch.shots);
    const versions = new Set(batch.shots.map(x => x.skillVersionId));
    const refs = materials.filter(x => x.kind === 'benchmark' ? x.skillVersionIds?.some(id => versions.has(id))
      : originalIds.has(x.sourceId) ? required.has(x.sourceId) : x.batch === null || x.batch === batch.number);
    const referenceList = refs.map((ref, index) => `${index + 1}. ${ref.name}｜${ref.productGroupLabel ? ref.productGroupLabel + '｜' : ''}${ref.kind === 'benchmark' ? '必需原对标视频' : referenceRoleLabels[ref.kind] ?? ref.kind}`).join('\n');
    const groups = snapshot.input?.productGroups;
    const groupSummary = groups?.length ? `\n商品分组（用途：${snapshot.input.productUse ? productUseLabels[snapshot.input.productUse] : '单款'}）：\n${groups.map((group, index) => `组${index + 1}｜款号 ${group.styleNumber}｜${group.name || group.styleNumber}`).join('\n')}\n仅使用本批已连接的组图，不将不同款号的细节互相替换。` : '';
    const prompt = `${renderPrompt(output, batch.shots)}${groupSummary}\n\n本批参考图顺序与用途：\n${referenceList}\n${batch.note}`;
    // Stay below Windows CreateProcess's command-line limit without truncating any saved content.
    const texts = Array.from({ length: Math.ceil(prompt.length / 10000) }, (_, i) => ({ name: `${prefix}-第${batch.number}批提示词${i + 1}`, content: prompt.slice(i * 10000, (i + 1) * 10000) }));
    const videoPrompt = prompt.length <= 16000 ? prompt : `请完整遵循连接到本视频节点的全部文本提示词，按编号连续阅读，不省略台词、声音、镜头和商品要求。${groupSummary}\n本批参考图顺序与用途：\n${referenceList}`;
    return { number: batch.number, groupKey, materialIds: refs.map(x => x.id), texts, video: { name: `${prefix}-第${batch.number}批视频`, prompt: videoPrompt } };
    }));
  }
  return plan;
}
