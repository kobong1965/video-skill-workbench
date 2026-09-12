import type { SkillInfo } from '../../../../packages/contracts';

type SkillFile = SkillInfo['files'][number];
export type PreviewFile = SkillFile & { mediaId: string };
export interface SkillPreview { video?: PreviewFile; image?: PreviewFile; }

export function getSkillPreview(files: readonly SkillFile[]): SkillPreview | undefined {
  const media = files.filter((file): file is PreviewFile => Boolean(file.mediaId));
  const videos = media.filter(file => file.mime === 'video/mp4');
  const images = media.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.mime));
  const isPreview = (file: PreviewFile) => /(^|\/)previews?\//i.test(file.path);
  const video = videos.find(isPreview) ?? videos[0];
  const image = images.find(file => /(^|\/)[^/]*(cover|poster|thumbnail|封面)[^/]*$/i.test(file.path))
    ?? images.find(isPreview) ?? images[0];
  return video || image ? { video, image } : undefined;
}
