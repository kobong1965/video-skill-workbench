/** Read-only local product catalogue. Filesystem paths never cross this boundary. */
export interface CatalogAsset {
  id: string;
  kind: 'main' | 'detail' | 'reference' | 'video';
  label: string;
  available: boolean;
  mediaType: 'image' | 'video';
  url: string;
}
export interface CatalogFolder { id: string; label: string; available: boolean; }
export interface CatalogShopBinding {
  shopName: string; market: string; productId: string; productUrl: string | null; matchStatus: string;
  matchedOn?: string; sourceType?: string; visualMatchNotes?: string; evidence?: unknown[];
}
export interface CatalogProduct {
  id: string; productUid: string; category: 'men' | 'women'; sku: string; name: string; title: string;
  sizes: string[]; note: string; coverId: string; assets: CatalogAsset[]; folders: CatalogFolder[];
  shopBindings: CatalogShopBinding[]; sourceMissing: boolean;
}
export interface CatalogSnapshot {
  products: CatalogProduct[]; syncedAt: string | null; sourceUpdatedAt: string | null;
  sourceHash: string | null; stale: boolean; error: string | null; sourceLabel: string;
  counts: { products: number; men: number; women: number; images: number; videos: number; folders: number };
}
