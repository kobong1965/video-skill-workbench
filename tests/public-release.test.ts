import { describe, expect, it } from 'vitest';
import { publicRelativePath, publicSkillMetadata, assertPublicText, createSkillExport, sanitizeDependencyDocumentation } from '../scripts/public-release-safety';
import { unzipSync } from 'fflate';

describe('public release boundary', () => {
  it.each(['../secret.txt', 'C:/secret.txt', '/absolute', 'a\\b', '.env', 'a/local-secrets.json', 'a/postgres-local.json', 'desktop-profile/Cookies', 'a/../../b', 'a//b'])('rejects unsafe or private path %s', value => {
    expect(() => publicRelativePath(value)).toThrow();
  });
  it('preserves Chinese material names and only exports approved metadata', () => {
    expect(publicRelativePath('assets/视频节点 1.mp4')).toBe('assets/视频节点 1.mp4');
    const result = publicSkillMetadata({ name: '脚本', tags: ['裤装'], number: 2, kind: 'opening', duration: '7', source: '已确认', owner_id: 'private', password: 'private' });
    expect(result).toEqual({ name: '脚本', tags: ['裤装'], version: 2, kind: 'opening', duration: 7, source: '已确认' });
  });
  it('distinguishes a cookie implementation folder from an actual browser cookie database', () => {
    expect(publicRelativePath('server/node_modules/undici/lib/web/cookies/index.js')).toBe('server/node_modules/undici/lib/web/cookies/index.js');
    expect(() => publicRelativePath('profile/Cookies')).toThrow();
  });
  it('blocks credential values without printing them', () => {
    const value = 'ghp_' + 'x'.repeat(36);
    expect(() => assertPublicText(`value=${value}`, 'note.txt')).toThrow('note.txt');
    try { assertPublicText(value, 'note.txt'); } catch (error) { expect(String(error)).not.toContain(value); }
    expect(() => assertPublicText('API keys are configured locally.', 'README.md')).not.toThrow();
  });
  it.each(['server/node_modules/example/README.md', 'server/node_modules/example/docs/index.md'])('removes an upstream coverage badge query only from dependency documentation: %s', filename => {
    const badge = 'https://codecov.io/gh/example/lib/branch/main/graph/badge.svg?token=' + 'x'.repeat(24);
    const clean = sanitizeDependencyDocumentation(Buffer.from(`[![coverage](${badge})](https://codecov.io)`), filename);
    expect(clean.toString()).not.toContain('?token=');
    expect(() => assertPublicText(clean.toString(), 'README.md')).not.toThrow();
    expect(sanitizeDependencyDocumentation(Buffer.from(badge), 'apps/api/main.ts').toString()).toBe(badge);
  });
  it('rebuilds an importable package without changing its script or video requirement', async () => {
    const text = '# 裤装\n默认14秒\n[原视频](assets/original.mp4)';
    const result = await createSkillExport(text, [
      { path: 'pants/SKILL.md', text, media_id: null },
      { path: 'pants/workbench.json', text: JSON.stringify({ referenceVideoRequired: true, benchmarkVideo: 'assets/original.mp4' }), media_id: null },
      { path: 'pants/assets/original.mp4', text: null, media_id: 'video' },
    ], async () => Buffer.from('reference-video'));
    expect(result.parsed.missing).toEqual([]);
    expect(result.parsed.text).toBe(text);
    expect(Buffer.from(unzipSync(result.archive)['pants/assets/original.mp4']).toString()).toBe('reference-video');
  });
  it('rejects missing media, mismatched main script and case-colliding paths', async () => {
    await expect(createSkillExport('# Current', [{ path: 'SKILL.md', text: '# Old', media_id: null }], async () => Buffer.alloc(0))).rejects.toThrow();
    await expect(createSkillExport('# Current', [{ path: 'SKILL.md', text: '# Current', media_id: null }, { path: 'assets/image.png', text: null, media_id: null }], async () => Buffer.alloc(0))).rejects.toThrow();
    await expect(createSkillExport('# Current', [{ path: 'SKILL.md', text: '# Current', media_id: null }, { path: 'skill.md', text: '# Duplicate', media_id: null }], async () => Buffer.alloc(0))).rejects.toThrow();
  });
});
