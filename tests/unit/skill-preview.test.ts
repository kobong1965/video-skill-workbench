import { describe, expect, it } from 'vitest';
import type { SkillInfo } from '../../packages/contracts';
import { getSkillPreview } from '../../apps/web/src/skills/skill-preview';

type File = SkillInfo['files'][number];
const video: File = { path: 'assets/effect.mp4', mime: 'video/mp4', mediaId: 'video' };
const image: File = { path: 'references/screenshot.png', mime: 'image/png', mediaId: 'image' };

describe('创作卡片预览素材', () => {
  it('读取当前版本的视频，并以包里的图片作为封面', () => {
    expect(getSkillPreview([image, video])).toEqual({ video, image });
  });
  it('补传的预览视频优先于包内普通视频，封面优先于参考截图', () => {
    const uploaded = { ...video, path: 'previews/new/effect.mp4', mediaId: 'new-video' };
    const cover = { ...image, path: 'assets/cover.webp', mediaId: 'cover', mime: 'image/webp' };
    expect(getSkillPreview([image, video, cover, uploaded])).toEqual({ video: uploaded, image: cover });
  });
  it('仅有图片时提供图片预览，不伪装成视频', () => {
    expect(getSkillPreview([image])).toEqual({ image, video: undefined });
  });
  it('仅有视频时无需封面也能播放', () => {
    expect(getSkillPreview([video])).toEqual({ video, image: undefined });
  });
  it('忽略没有媒体编号的外部引用、正文和不支持的媒体', () => {
    expect(getSkillPreview([
      { ...video, mediaId: undefined }, { ...image, mediaId: '' },
      { path: 'SKILL.md', mime: 'text/markdown', text: '# example' },
      { path: 'external.svg', mime: 'image/svg+xml', mediaId: 'svg' },
    ])).toBeUndefined();
    expect(getSkillPreview([])).toBeUndefined();
  });
  it('不会改动文件顺序或把其他版本的素材带到当前版本', () => {
    const files = Object.freeze([image, video]);
    getSkillPreview(files);
    expect(files).toEqual([image, video]);
    expect(getSkillPreview([{ path: 'SKILL.md', mime: 'text/markdown' }])).toBeUndefined();
  });
});
