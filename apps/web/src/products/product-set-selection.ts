import { MAX_PRODUCT_GROUPS, MAX_TASK_IMAGES, type CreationInput, type ProductGroup, type ProductImageSet, type ProductUse } from '../../../../packages/contracts';
import { catalogChoiceKey, choiceSelectionKey, groupSelectionKey, isCatalogChoice, type ProductChoice } from './product-choice';

type PreviousProduct = Pick<CreationInput, 'facts' | 'extra'> & Partial<Pick<CreationInput, 'productSetId' | 'productGroups' | 'productUse'>>;
type ProductPatch = Pick<CreationInput, 'productSetId' | 'styleNumber' | 'productName' | 'media' | 'facts' | 'extra' | 'productGroups' | 'productUse'> & Partial<Pick<CreationInput, 'market' | 'platform'>>;

function sameProducts(previous: PreviousProduct | undefined, groups: ProductGroup[], use: ProductUse) {
  const oldIds = previous?.productGroups?.map(groupSelectionKey) ?? (previous?.productSetId ? [`manual:${previous.productSetId}`] : []);
  return (previous?.productUse ?? 'colors') === use && oldIds.length === groups.length && oldIds.every((id, index) => id === groupSelectionKey(groups[index]));
}

export function productSetPatch(set: ProductImageSet, previous?: PreviousProduct): ProductPatch {
  return productSetsPatch([set], 'colors', previous);
}

export function productSetsPatch(sets: ProductChoice[], productUse: ProductUse, previous?: PreviousProduct): ProductPatch {
  if (!sets.length || sets.length > MAX_PRODUCT_GROUPS) throw new Error(`请选择 1–${MAX_PRODUCT_GROUPS} 个款号`);
  if (new Set(sets.map(choiceSelectionKey)).size !== sets.length) throw new Error('同一款号不能重复选择');
  const catalogKeys = sets.filter(isCatalogChoice).map(set => catalogChoiceKey(set.catalog.productUid, set.catalog.binding));
  if (new Set(catalogKeys).size !== catalogKeys.length) throw new Error('同一商品和店铺绑定不能重复选择');
  if (sets.some(set => set.media.length > 12)) throw new Error('每款最多支持 12 张图片，不会自动删图');
  const productGroups: ProductGroup[] = sets.map(set => ({ ...(isCatalogChoice(set) ? { source: 'catalog' as const, catalogSelectionId: set.id, catalog: structuredClone(set.catalog) } : { productSetId: set.id }), styleNumber: set.styleNumber, name: set.name, mediaIds: set.media.map(file => file.id) }));
  const media = [...new Map(sets.flatMap(set => set.media).map(({ id, role }) => [id, { id, role }])).values()];
  if (media.length > MAX_TASK_IMAGES) throw new Error(`本次共 ${media.length} 张图，最多支持 ${MAX_TASK_IMAGES} 张；请减少图套，不会自动删图`);
  const retained = sameProducts(previous, productGroups, productUse);
  const base = {
    ...(catalogKeys.length ? { market: 'US' as const, platform: 'tiktok' as const } : {}),
    productSetId: sets.length === 1 && !isCatalogChoice(sets[0]) ? sets[0].id : undefined,
    styleNumber: sets.length === 1 ? sets[0].styleNumber : undefined,
    productName: sets.map(set => set.name || set.styleNumber).join(' / ').slice(0, 100),
    productGroups, productUse, media,
    facts: retained ? previous!.facts : '', extra: retained ? previous!.extra : '',
  };
  return { ...base, ...productUsePatch(base, productUse, sets) };
}

/** Reapply canonical roles only to the currently selected images. Removed images stay removed. */
export function productUsePatch(input: Pick<CreationInput, 'media' | 'productGroups' | 'productUse' | 'facts' | 'extra'>, productUse: ProductUse, sets: ProductChoice[]): Partial<ProductPatch> & Pick<ProductPatch, 'media'> {
  const groups = input.productGroups ?? [];
  if (productUse === 'comparison' && groups.length > 1) {
    const main = new Set(groups[0].mediaIds);
    if (groups.slice(1).some(group => group.mediaIds.some(id => main.has(id)))) throw new Error('主商品与对比商品不能共用同一张图片，请调整图套或用途');
  }
  const canonical = new Map(sets.map(set => [choiceSelectionKey(set), new Map(set.media.map(file => [file.id, file.role]))]));
  const groupedRoles = new Map<string, CreationInput['media'][number]['role']>();
  const originalRoles = new Map<string, CreationInput['media'][number]['role']>();
  groups.forEach((group, index) => {
    for (const id of group.mediaIds) {
      const original = canonical.get(groupSelectionKey(group))?.get(id);
      if (!original) throw new Error(`款号 ${group.styleNumber} 的图片已变化，请重新选择图套`);
      const prior = originalRoles.get(id);
      if (prior && prior !== original) throw new Error('同一图片在不同图套的用途不一致，请调整图套或移除重复图片');
      originalRoles.set(id, original);
      const role = productUse === 'comparison' && index > 0 ? 'comparison' : original;
      groupedRoles.set(id, role);
    }
  });
  const changed = input.productUse !== productUse;
  return {
    productGroups: groups, productUse,
    media: input.media.map(file => ({ ...file, role: groupedRoles.get(file.id) ?? file.role })),
    facts: changed ? '' : input.facts, extra: changed ? '' : input.extra,
  };
}

export function productGroupsError(input: Pick<CreationInput, 'media' | 'productGroups' | 'productUse'>): string {
  const groups = input.productGroups ?? [];
  if (input.media.length > MAX_TASK_IMAGES) return `最多支持 ${MAX_TASK_IMAGES} 张图`;
  if (!groups.length) return '';
  if (groups.length > MAX_PRODUCT_GROUPS) return `最多支持 ${MAX_PRODUCT_GROUPS} 个款号`;
  if (groups.length > 1 && !input.productUse) return '请选择商品用途';
  const files = new Map(input.media.map(file => [file.id, file]));
  for (const [index, group] of groups.entries()) {
    if (group.mediaIds.some(id => !files.has(id))) return `款号 ${group.styleNumber} 引用了缺失图片，请重新选择图套`;
    const images = group.mediaIds.map(id => files.get(id)).filter(file => file !== undefined);
    if (!images.length) return `款号 ${group.styleNumber} 没有图片，请重新选款或移除该款号`;
    if (input.productUse === 'comparison' && index > 0) {
      if (images.some(file => file.role !== 'comparison')) return `款号 ${group.styleNumber} 的图片应作为对比商品`;
    } else if (!images.some(file => file.role === 'product')) return `款号 ${group.styleNumber} 缺少主商品图`;
  }
  return '';
}

export function removeProductImage(input: Pick<CreationInput, 'media' | 'productGroups'>, id: string): Pick<CreationInput, 'media' | 'productGroups'> {
  return { media: input.media.filter(file => file.id !== id), productGroups: input.productGroups?.map(group => ({ ...group, mediaIds: group.mediaIds.filter(mediaId => mediaId !== id) })) };
}
