import type { TaskSnapshot, Shot } from '../contracts';

export const referenceRoleLabels: Record<string, string> = { product: '主商品外观', detail: '同款细节', comparison: '对比商品', person: '人物身份', angle: '人物角度', scene: '场景', storyboard: '本批故事面板', tailframe: '上一批真实尾帧' };

export function validateReferences(shots: Shot[], allowed: Iterable<string>) {
  const valid = new Set(allowed);
  if (shots.some(shot => shot.references.some(id => !valid.has(id)))) throw new Error('镜头引用了本任务中不存在的素材，请核对参考图');
}
export function batchMediaIds(snapshot: TaskSnapshot, shots: Shot[]) {
  const specified = new Set(shots.flatMap(shot => shot.references));
  // With no per-shot product references, use current product/detail pictures;
  // comparison pictures are never silently made a main garment reference.
  const chosen = snapshot.media.filter(media => specified.has(media.id));
  return new Set((chosen.length ? chosen : snapshot.media.filter(media => media.role !== 'comparison')).map(media => media.id));
}
