import { z } from 'zod';

export const idSchema = z.string().uuid();
export const skillKinds = ['opening', 'detail', 'outfit', 'comparison', 'full'] as const;
export const voiceModes = ['inherit', 'none', 'voiceover', 'onscreen'] as const;
export const selectionSchema = z.object({
  id: idSchema, versionId: idSchema, duration: z.number().min(0.5).max(300),
});
export const creationSchema = z.object({
  name: z.string().trim().max(100).default('未命名创作'),
  media: z.array(z.object({ id: idSchema, role: z.enum(['product', 'detail', 'comparison']) })).min(1).max(12),
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
    references: z.array(z.string().max(100)).max(20),
  })).min(1).max(100),
  assetPlan: z.array(z.object({ kind: z.enum(['person', 'scene', 'angle', 'storyboard']), name: z.string().max(100), prompt: z.string().max(6000) })).max(30),
});
export type PromptOutput = z.infer<typeof outputSchema>;
export type Shot = PromptOutput['shots'][number];
export interface SelectedSkill {
  id: string; versionId: string; name: string; kind: typeof skillKinds[number]; duration: number;
  text?: string; references?: { path: string; text: string }[];
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
export interface SkillInfo {
  requirements?: { referenceVideoRequired: true; benchmarkVideo?: { path: string; mime: string; mediaId?: string } };
  id: string; ownerId: string; name: string; tags: string[]; kind: typeof skillKinds[number];
  duration: number; visibility: 'private' | 'public'; versionId: string; version: number;
  source: string; text: string; missing: string[]; files: { path: string; mediaId?: string; text?: string; mime: string }[];
}
export interface ResultRevision { id: string; number: number; output: PromptOutput; confirmed: boolean; createdAt: string; }
export interface JobInfo { id: string; kind: 'text' | 'image'; status: string; error: string | null; attempts: number; payload: Record<string, unknown>; }
export interface AssetInfo {
  id: string; name: string; kind: string; mediaId: string; taskId: string | null; resultId: string | null;
  parentId: string | null; confirmed: boolean; stale: boolean; batch: number | null;
}
export interface TaskInfo {
  id: string; name: string; snapshot: TaskSnapshot; status: string; createdAt: string;
  results: ResultRevision[]; jobs: JobInfo[]; assets: AssetInfo[];
}
