import type { SkillInfo } from '../contracts';
import path from 'node:path';
import { z } from 'zod';

const settings = z.object({ referenceVideoRequired: z.boolean(), benchmarkVideo: z.string().min(1).max(250).optional() }).strict();

export function getSkillRequirements(files: readonly SkillInfo['files'][number][]): SkillInfo['requirements'] {
  const manifests = files.filter(file => /(^|\/)workbench\.json$/i.test(file.path));
  if (!manifests.length) return undefined;
  if (manifests.length !== 1) throw new Error('Skill 只能包含一份 workbench.json');
  const manifest = manifests[0];
  let config: z.infer<typeof settings>;
  try { config = settings.parse(JSON.parse(manifest.text ?? '')); }
  catch { throw new Error('workbench.json 格式无效：请明确填写 referenceVideoRequired 布尔值'); }
  if (config.benchmarkVideo && (/^[\/]|[\\:\x00-\x1f]/.test(config.benchmarkVideo) || config.benchmarkVideo.split('/').includes('..'))) throw new Error('对标视频必须引用包内相对路径');
  if (!config.referenceVideoRequired) return undefined;
  const target = config.benchmarkVideo ? path.posix.join(path.posix.dirname(manifest.path), config.benchmarkVideo) : undefined;
  const video = files.find(file => file.path === target && file.mime === 'video/mp4');
  return { referenceVideoRequired: true, benchmarkVideo: video ? { path: video.path, mime: video.mime, ...(video.mediaId ? { mediaId: video.mediaId } : {}) } : undefined };
}
