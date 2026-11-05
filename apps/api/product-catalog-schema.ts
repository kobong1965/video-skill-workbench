import { z } from 'zod';

const text = z.string().max(2000);
const identity = z.string().min(1).max(200).refine(value => !/[\x00-\x1f]/.test(value));
const filePath = z.string().min(1).max(4000);
const evidence = z.object({
  screenshot: z.string().max(1000).refine(value => !/^(?:[a-z]:|[\\/])/i.test(value) && !value.split(/[\\/]/).includes('..')),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i), row: z.number().int().positive().optional(),
});
export const catalogProductSchema = z.object({
  id: identity, productUid: z.string().uuid(), category: z.enum(['men', 'women']), sku: identity,
  name: text, title: text.default(''), sizes: z.array(z.string().max(100)).max(100).default([]), note: text.default(''),
  coverId: z.string().max(200).default(''),
  folders: z.array(z.object({ id: identity, label: text, path: filePath })).max(100),
  assets: z.array(z.object({ id: identity, label: text, kind: z.enum(['main', 'detail', 'reference', 'video']), path: filePath })).max(2000),
  shopBindings: z.array(z.object({
    shopName: identity, market: identity, productId: z.string().regex(/^\d{19}$/),
    productUrl: z.string().url().max(2000).refine(value => /^https:\/\//i.test(value)).nullable().default(null),
    matchStatus: text, matchedOn: text.optional(), sourceType: text.optional(), visualMatchNotes: text.optional(),
    evidence: z.array(evidence).max(100).optional(),
  })).max(100).default([]),
});
export const sourceCatalogSchema = z.object({ generatedAt: z.string().max(100), products: z.array(catalogProductSchema).max(10000) });
export type SourceProduct = z.infer<typeof catalogProductSchema>;

function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('catalog_identity_conflict'); }
export function validateIdentities(products: SourceProduct[]) {
  unique(products.map(product => product.productUid));
  unique(products.map(product => product.id));
  for (const product of products) {
    unique(product.assets.map(asset => asset.id)); unique(product.folders.map(folder => folder.id));
    unique(product.shopBindings.map(binding => JSON.stringify([binding.shopName, binding.market, binding.productId])));
    if (product.coverId && !product.assets.some(asset => asset.id === product.coverId && asset.kind !== 'video')) throw new Error('catalog_invalid_cover');
  }
}
