import type { ProductGroup, ProductImageSet } from '../../../../packages/contracts';
import type { CatalogProduct, CatalogShopBinding, CatalogSnapshot } from '../../../../packages/contracts/product-catalog';
import { catalogChoiceKey, groupSelectionUrl } from './product-choice';

export interface PickerOption {
  key: string; styleNumber: string; name: string; source: 'manual' | 'catalog';
  imageKeys: string[]; coverUrl?: string; category?: 'men' | 'women'; binding?: CatalogShopBinding;
  disabledReason?: string; savedUrl?: string;
  request?: { productUid: string; sourceHash: string; binding: { shopName: string; market: string; productId: string }; assetIds: string[] };
}
export function manualOptions(sets: ProductImageSet[]): PickerOption[] {
  return sets.map(set => ({ key: `manual:${set.id}`, source: 'manual', styleNumber: set.styleNumber, name: set.name,
    imageKeys: set.media.map(file => file.id), coverUrl: `/api/media/${(set.media.find(file => file.role === 'product') ?? set.media[0])?.id}`,
    savedUrl: `/api/product-sets/${set.id}` }));
}
function unavailable(product: CatalogProduct, binding: CatalogShopBinding | undefined, snapshot: CatalogSnapshot) {
  const images = product.assets.filter(asset => asset.mediaType === 'image');
  if (snapshot.stale || !snapshot.sourceHash) return '产品表未同步成功，请先同步';
  if (product.sourceMissing) return '来源已缺失';
  if (!binding || !/^\d{19}$/.test(binding.productId)) return '缺少完整商品 ID';
  if (binding.market !== 'US' || binding.matchStatus !== 'image_matched') return '店铺商品绑定需要确认';
  if (!images.length || !images.some(asset => asset.kind === 'main')) return '缺少主商品图';
  if (images.some(asset => !asset.available)) return '部分图片缺失，请先修复来源';
  if (images.length > 12) return '超过每款 12 张上限，请先整理产品表';
  return '';
}
export function catalogOptions(snapshot: CatalogSnapshot): PickerOption[] {
  return snapshot.products.flatMap(product => (product.shopBindings.length ? product.shopBindings : [undefined]).map(binding => {
    const key = `catalog:${binding ? catalogChoiceKey(product.productUid, binding) : product.productUid}`;
    const images = product.assets.filter(asset => asset.mediaType === 'image');
    const cover = images.find(asset => asset.id === product.coverId) ?? images.find(asset => asset.kind === 'main');
    return { key, source: 'catalog', styleNumber: product.sku, name: product.name, category: product.category, binding,
      imageKeys: images.map(asset => `${key}:${asset.id}`), coverUrl: cover?.available ? cover.url : undefined,
      disabledReason: unavailable(product, binding, snapshot),
      request: binding && snapshot.sourceHash ? { productUid: product.productUid, sourceHash: snapshot.sourceHash,
        binding: { shopName: binding.shopName, market: binding.market, productId: binding.productId }, assetIds: images.map(asset => asset.id) } : undefined,
    } satisfies PickerOption;
  }));
}
export function savedOptions(groups: ProductGroup[]): PickerOption[] {
  return groups.map(group => group.source === 'catalog' && !group.catalog ? {
    key: `catalog-invalid:${group.catalogSelectionId}`, source: 'catalog', styleNumber: group.styleNumber, name: group.name,
    imageKeys: group.mediaIds, disabledReason: '商品绑定快照缺失，请移除此项后重新选择产品表款号',
  } : ({
    key: group.source === 'catalog' && group.catalog ? `catalog:${catalogChoiceKey(group.catalog.productUid, group.catalog.binding)}` : `manual:${group.productSetId}`,
    source: group.source === 'catalog' ? 'catalog' : 'manual', styleNumber: group.styleNumber, name: group.name,
    imageKeys: group.mediaIds, coverUrl: group.mediaIds.length ? `/api/media/${group.mediaIds[0]}` : undefined,
    category: group.catalog?.category, binding: group.catalog?.binding, savedUrl: groupSelectionUrl(group),
  }));
}
export const optionLabel = (option: PickerOption) => option.source === 'catalog'
  ? `${option.styleNumber} · ${option.binding?.shopName ?? '未绑定店铺'} · ${option.binding?.productId ?? '无商品 ID'}` : option.styleNumber;
