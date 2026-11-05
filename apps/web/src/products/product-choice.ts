import type { ProductGroup, ProductImageSet } from '../../../../packages/contracts';
import type { CatalogSelection } from '../../../../packages/contracts/catalog-selection';
import type { CatalogShopBinding } from '../../../../packages/contracts/product-catalog';

export type ProductChoice = ProductImageSet | CatalogSelection;
export const isCatalogChoice = (choice: ProductChoice): choice is CatalogSelection => 'source' in choice && choice.source === 'catalog';
export const catalogChoiceKey = (productUid: string, binding: Pick<CatalogShopBinding, 'shopName' | 'market' | 'productId'>) => JSON.stringify([productUid, binding.market, binding.shopName, binding.productId]);
export const groupSelectionId = (group: ProductGroup) => group.source === 'catalog' ? group.catalogSelectionId! : group.productSetId!;
export const groupSelectionKey = (group: ProductGroup) => `${group.source === 'catalog' ? 'catalog' : 'manual'}:${groupSelectionId(group)}`;
export const choiceSelectionKey = (choice: ProductChoice) => `${isCatalogChoice(choice) ? 'catalog' : 'manual'}:${choice.id}`;
export const groupSelectionUrl = (group: ProductGroup) => group.source === 'catalog'
  ? `/api/product-catalog/selections/${group.catalogSelectionId}` : `/api/product-sets/${group.productSetId}`;
