import type { Shot, TaskSnapshot } from '../contracts';

export const productUseLabels = { colors: '换色', outfit: '搭配', comparison: '对比' } as const;

export function productGroupLabel(snapshot: TaskSnapshot, mediaId: string) {
  return (snapshot.input?.productGroups ?? []).flatMap((group, index) => {
    if (!group.mediaIds.includes(mediaId)) return [];
    const role = snapshot.input.productUse === 'comparison' ? index === 0 ? '主商品' : '对比商品' : '商品';
    return [`组${index + 1}｜款号 ${group.styleNumber}｜${group.name || group.styleNumber}｜${role}`];
  }).join('；');
}

/** Coverage is checked across the complete result, not each color-change shot. */
export function validateProductGroupReferences(snapshot: TaskSnapshot, shots: Pick<Shot, 'references'>[]) {
  const groups = snapshot.input?.productGroups ?? [];
  if (groups.length < 2) return;
  const used = new Set(shots.flatMap(shot => shot.references));
  const missing = groups.filter(group => !group.mediaIds.some(id => used.has(id)));
  if (missing.length) throw new Error(`镜头参考图遗漏所选款号：${missing.map(group => group.styleNumber).join('、')}；请为每组明确引用图片，不以文字提及代替实际引用`);
}
