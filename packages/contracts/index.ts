import { z } from 'zod';
import { catalogSelectionSnapshotSchema } from './catalog-selection';

export const idSchema = z.string().uuid();
export const skillKinds = ['opening', 'detail', 'outfit', 'comparison', 'full'] as const;
export const voiceModes = ['inherit', 'none', 'voiceover', 'onscreen'] as const;
export const MAX_TASK_IMAGES = 36;
export const MAX_PRODUCT_GROUPS = 6;
export const productUses = ['colors', 'outfit', 'comparison'] as const;
export const productGroupSchema = z.object({
  source: z.enum(['manual', 'catalog']).optional(),
  productSetId: idSchema.optional(),
  catalogSelectionId: idSchema.optional(),
  catalog: catalogSelectionSnapshotSchema.optional(),
  styleNumber: z.string().trim().min(1).max(80),
  name: z.string().trim().max(100).default(''),
  mediaIds: z.array(idSchema).min(1).max(12),
}).superRefine((group, context) => {
  if (group.source === 'catalog' ? !group.catalogSelectionId || !!group.productSetId : !group.productSetId || !!group.catalogSelectionId || !!group.catalog) context.addIssue({ code: 'custom', message: '款号来源与关联记录不一致，请重新选择' });
  if (new Set(group.mediaIds).size !== group.mediaIds.length) context.addIssue({ code: 'custom', path: ['mediaIds'], message: '图套内不能重复选择同一图片' });
});
export type ProductGroup = z.infer<typeof productGroupSchema>;
export type ProductUse = typeof productUses[number];
export const selectionSchema = z.object({
  id: idSchema, versionId: idSchema, duration: z.number().min(0.5).max(300),
});
export const creationSchema = z.object({
  name: z.string().trim().max(100).default('未命名创作'),
  media: z.array(z.object({ id: idSchema, role: z.enum(['product', 'detail', 'comparison']) })).min(1).max(MAX_TASK_IMAGES, `单次任务最多 ${MAX_TASK_IMAGES} 张图片`),
  platform: z.enum(['douyin', 'tiktok']), market: z.enum(['CN', 'US', 'VN']),
  category: z.string().trim().min(1).max(50),
  targetDuration: z.number().min(1).max(300), model: z.enum(['seedance-2.0', 'seedance-2.5']),
  generatePerson: z.boolean(), generateScene: z.boolean(),
  voice: z.enum(voiceModes).default('inherit'),
  selections: z.array(selectionSchema).min(1).max(12),
  productName: z.string().max(100).default(''), facts: z.string().max(2000).default(''),
  audience: z.string().max(300).default(''), personNotes: z.string().max(1000).default(''),
  sceneNotes: z.string().max(1000).default(''), extra: z.string().max(2000).default(''),
  parentId: idSchema.optional(),
  productSetId: idSchema.optional(),
  styleNumber: z.string().trim().min(1).max(80).optional(),
  productUse: z.enum(productUses).optional(),
  productGroups: z.array(productGroupSchema).min(1).max(MAX_PRODUCT_GROUPS).optional(),
}).superRefine((input, context) => {
  const groups = input.productGroups;
  if (!groups) return;
  if (groups.length > 1 && !input.productUse) context.addIssue({ code: 'custom', path: ['productUse'], message: '请选择多款号用途：换色、搭配或对比' });
  if (new Set(groups.map(group => `${group.source === 'catalog' ? 'catalog:' + group.catalogSelectionId : 'manual:' + group.productSetId}`)).size !== groups.length) context.addIssue({ code: 'custom', path: ['productGroups'], message: '不能重复选择同一款号图套' });
});
export type CreationInput = z.infer<typeof creationSchema>;
export const outputSchema = z.object({
  productFacts: z.array(z.object({ text: z.string().min(1).max(500), source: z.enum(['visible', 'provided']) })).max(30),
  unknowns: z.array(z.string().max(500)).max(30),
  conflicts: z.array(z.string().max(1000)).max(20),
  globalPrompt: z.string().min(10).max(12000),
  shots: z.array(z.object({
    skillVersionId: z.string().min(1), duration: z.number().min(0.5).max(300),
    title: z.string().min(1).max(100), prompt: z.string().min(3).max(8000),
    dialogue: z.string().max(2000), translation: z.string().max(2000),
    storyAudio: z.string().max(2000), startState: z.string().max(1500), endState: z.string().max(1500),
    references: z.array(z.string().max(100)).max(MAX_TASK_IMAGES),
  })).min(1).max(100),
  assetPlan: z.array(z.object({ kind: z.enum(['person', 'scene', 'angle', 'storyboard']), name: z.string().max(100), prompt: z.string().max(6000) })).max(30),
});
export type PromptOutput = z.infer<typeof outputSchema>;
export type Shot = PromptOutput['shots'][number];
export interface SelectedSkill {
  id: string; versionId: string; name: string; kind: typeof skillKinds[number]; duration: number;
  text?: string; references?: { path: string; text: string }[];
  /** Frozen at task creation; absent only on legacy task snapshots. */
  preview?: { imageMediaId: string | null; videoMediaId: string | null };
}
export interface Capability {
  min: number; max: number; source: string; checkedAt: string; verified: boolean;
}
export interface TaskSnapshot {
  input: CreationInput; skills: SelectedSkill[]; capability: Capability;
  media: { id: string; role: string; name: string; mime: string }[];
}
export interface User { id: string; username: string; displayName: string; role: 'admin' | 'member'; active: boolean; }
export type ApiResult<T> = { data: T };
export interface MediaInfo { id: string; name: string; mime: string; size: number; }
export interface ProductImageSetMedia { id: string; role: 'product' | 'detail' | 'comparison'; name: string; }
export interface ProductImageSet {
  id: string; styleNumber: string; name: string; media: ProductImageSetMedia[];
  createdAt: string; updatedAt: string;
}
export interface SkillInfo {
  requirements?: { referenceVideoRequired: true; benchmarkVideo?: { path: string; mime: string; mediaId?: string } };
  id: string; ownerId: string; name: string; tags: string[]; kind: typeof skillKinds[number];
  duration: number; visibility: 'private' | 'public'; versionId: string; version: number;
  source: string; text: string; missing: string[]; files: { path: string; mediaId?: string; text?: string; mime: string }[];
}
export interface ResultRevision { id: string; number: number; output: PromptOutput; confirmed: boolean; createdAt: string; }
export interface TaskProgress {
  stage: 'draft' | 'queued' | 'preparing' | 'waiting' | 'validating' | 'saving' | 'ready' | 'failed' | 'unknown' | 'invalid';
  label: string;
  /** Only queued/not started (0) and durably saved results (100) are numeric. */
  value: number | null;
}
export interface JobProvider { id: string; name: string; model: string; }
export interface JobInfo { id: string; kind: 'text' | 'image'; status: string; error: string | null; attempts: number; payload: Record<string, unknown>; progress?: TaskProgress; provider?: JobProvider | null; }
export interface TaskJobSummary {
  id: string; kind: 'text' | 'image'; status: string; error: string | null; attempts: number;
  createdAt: string; sentAt: string | null; finishedAt: string | null; progress: TaskProgress;
  provider?: JobProvider | null;
}
export interface TaskSkillPreview {
  id: string; versionId: string; name: string;
  imageMediaId: string | null; videoMediaId: string | null;
}
export interface TaskCanvasUploadSummary {
  /** Applies to the latest saved result, independently of generation progress. */
  status: 'not_uploaded' | 'uploading' | 'uploaded' | 'failed' | 'unknown';
  resultId: string | null; importId: string | null; projectId: string | null; projectUrl: string | null;
  updatedAt: string | null;
  /** A different result revision was uploaded; the current revision still has its own status. */
  previouslyUploaded: boolean;
}
export interface TaskSummary {
  id: string; name: string; status: string; createdAt: string; updatedAt: string; parentId: string | null;
  thumbnailMediaId: string | null; latestResultId: string | null; latestJob: TaskJobSummary | null;
  activeJobs: number; progress: TaskProgress;
  skillPreviews?: TaskSkillPreview[];
  canvasUpload?: TaskCanvasUploadSummary;
}
export interface AssetInfo {
  id: string; name: string; kind: string; mediaId: string; taskId: string | null; resultId: string | null;
  parentId: string | null; confirmed: boolean; stale: boolean; batch: number | null;
}
export interface TaskInfo {
  id: string; name: string; snapshot: TaskSnapshot; status: string; createdAt: string;
  results: ResultRevision[]; jobs: JobInfo[]; assets: AssetInfo[];
}
