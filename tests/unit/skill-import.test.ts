import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillPackage } from '../../packages/domain/skill-import';

describe('Skill 包只作为资料读取', () => {
  it('读取主稿和嵌套引用，提示缺失项，不联网取外链', async () => {
    const zip = zipSync({ 'skill/SKILL.md': strToU8('# 测试\n[镜头](references/shots.md) [丢失](missing.png) [网站](https://example.com)'), 'skill/references/shots.md': strToU8('0–6秒 开场动作') });
    const result = await parseSkillPackage(Buffer.from(zip), 'sample.zip');
    expect(result.text).toContain('镜头');
    expect(result.missing).toContain('skill/missing.png');
    expect(result.files.find(f => f.path === 'skill/references/shots.md')?.text).toContain('开场');
  });
  it('拒绝路径穿越和可执行脚本', async () => {
    await expect(parseSkillPackage(Buffer.from(zipSync({ '../escape.md': strToU8('bad') })), 'bad.zip')).rejects.toThrow();
    await expect(parseSkillPackage(Buffer.from(zipSync({ 'SKILL.md': strToU8('x'), 'run.ps1': strToU8('do something') })), 'bad.zip')).rejects.toThrow('执行');
  });
  it('单独 Markdown 可导入并显示缺失引用', async () => {
    const result = await parseSkillPackage(Buffer.from('# 停车场\n[镜头](references/shots.md)'), 'SKILL.md');
    expect(result.missing).toEqual(['references/shots.md']);
  });
  it('兼容合成停车场包的嵌套 Markdown，不读取私人 Skill 或伪造视频', async () => {
    const entries = {
      'SKILL.md': strToU8('# 合成停车场方案 · 17秒\n[完整模板](references/prompt-template.md)'),
      'references/prompt-template.md': strToU8('## 2.1 镜头\n[动作](shots/actions.md)'),
      'references/shots/actions.md': strToU8('17秒合成镜头资料，仅供导入测试。'),
    };
    const result = await parseSkillPackage(Buffer.from(zipSync(entries)), 'parking.zip');
    expect(result.text).toContain('17秒');
    expect(result.files.find(x => x.path === 'references/prompt-template.md')?.text).toContain('2.1');
    expect(result.files.some(x => x.mime === 'video/mp4')).toBe(false);
    expect(result.missing).toEqual([]);
  });
});
