import { z } from 'zod';
import type { ProductImageSetMedia } from './index';

export const catalogBindingSchema = z.object({
  shopName: z.string().trim().min(1).max(120), market: z.literal('US'),
  productId: z.string().regex(/^\d{19}$/, '商品 ID 必须是完整的 19 位字符串'),
  productUrl: z.string().nullable(), matchStatus: z.literal('image_matched'), matchedOn: z.string().optional(),
});
export const catalogSelectionSnapshotSchema = z.object({
  selectionId: z.string().uuid(), productUid: z.string().uuid(), category: z.enum(['men', 'women']),
  sku: z.string().min(1).max(80), name: z.string().max(2000), binding: catalogBindingSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), sourceUpdatedAt: z.string(), selectedAt: z.string(),
  assets: z.array(z.object({
    assetId: z.string(), mediaId: z.string().uuid(), kind: z.enum(['main', 'detail', 'reference']),
    role: z.enum(['product', 'detail']), digest: z.string().regex(/^[a-f0-9]{64}$/), name: z.string(),
  })).min(1).max(12),
});
export type CatalogSelectionSnapshot = z.infer<typeof catalogSelectionSnapshotSchema>;
export interface CatalogSelection {
  id: string; source: 'catalog'; styleNumber: string; name: string; media: ProductImageSetMedia[];
  catalog: CatalogSelectionSnapshot; createdAt: string; updatedAt: string;
}
