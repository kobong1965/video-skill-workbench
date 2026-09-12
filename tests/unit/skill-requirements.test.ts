import { describe, expect, it } from 'vitest';
import { getSkillRequirements } from '../../packages/domain/skill-requirements';

describe('Skill 的显式对标素材要求', () => {
  const manifest = { path: 'sample/workbench.json', mime: 'application/json', text: JSON.stringify({ referenceVideoRequired: true, benchmarkVideo: 'assets/benchmark/original.mp4' }) };
  const reference = { path: 'sample/assets/benchmark/original.mp4', mime: 'video/mp4', mediaId: 'benchmark' };
  it('旧 Skill 不自动要求对标，不根据正文关键词猜测', () => {
    expect(getSkillRequirements([{ path: 'SKILL.md', mime: 'text/markdown', text: '对标视频' }])).toBeUndefined();
  });
  it('读取包内显式要求，准确指向原对标而非成片', () => {
    expect(getSkillRequirements([manifest, { path: 'sample/assets/approved/result.mp4', mime: 'video/mp4', mediaId: 'approved' }, reference])).toEqual({ referenceVideoRequired: true, benchmarkVideo: reference });
  });
  it('缺少视频时仍提醒，不把截图或其它 MP4 冒充对标', () => {
    expect(getSkillRequirements([manifest])).toEqual({ referenceVideoRequired: true, benchmarkVideo: undefined });
    expect(getSkillRequirements([manifest, { ...reference, mime: 'image/png' }])?.benchmarkVideo).toBeUndefined();
  });
  it('拒绝歧义配置、包外路径和非布尔配置', () => {
    expect(() => getSkillRequirements([manifest, { ...manifest, path: 'another/workbench.json' }])).toThrow();
    for (const benchmarkVideo of ['../outside.mp4', '/absolute.mp4', 'https://site/video.mp4', 'C:\\video.mp4']) {
      expect(() => getSkillRequirements([{ ...manifest, text: JSON.stringify({ referenceVideoRequired: true, benchmarkVideo }) }])).toThrow();
    }
    expect(() => getSkillRequirements([{ ...manifest, text: '{"referenceVideoRequired":"false"}' }])).toThrow();
  });
  it('明确关闭时不弹窗，不修改输入文件', () => {
    expect(getSkillRequirements([{ ...manifest, text: '{"referenceVideoRequired":false}' }])).toBeUndefined();
    const files = Object.freeze([manifest, reference]);
    getSkillRequirements(files); expect(files).toEqual([manifest, reference]);
  });
});
