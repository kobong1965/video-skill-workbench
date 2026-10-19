import type { SkillInfo } from '../contracts';

type SkillFile = SkillInfo['files'][number];
export type PreviewFile = SkillFile & { mediaId: string };
export interface SkillPreview { video?: PreviewFile; image?: PreviewFile; }

/** Shared by script cards and task snapshots, using only the selected version's files. */
export function getSkillPreview(files: readonly SkillFile[]): SkillPreview | undefined {
  const media = files.filter((file): file is PreviewFile => Boolean(file.mediaId));
  const videos = media.filter(file => file.mime === 'video/mp4');
  const images = media.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.mime));
  const isPreview = (file: PreviewFile) => /(^|\/)previews?\//i.test(file.path);
  const isCover = (file: PreviewFile) => /(^|\/)[^/]*(cover|poster|thumbnail|封面)[^/]*$/i.test(file.path);
  const video = videos.find(isPreview) ?? videos[0];
  const image = images.find(file => isPreview(file) && isCover(file)) ?? images.find(isPreview)
    ?? images.find(isCover) ?? images[0];
  return video || image ? { video, image } : undefined;
}
