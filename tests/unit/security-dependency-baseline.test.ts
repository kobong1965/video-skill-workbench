import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  packages: Record<string, { version?: string }>;
};
function atLeast(actual: string, minimum: string) {
  const parts = actual.split('.').map(Number);
  const floor = minimum.split('.').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) return false;
  for (let index = 0; index < 3; index++) {
    if (parts[index] !== floor[index]) return parts[index] > floor[index];
  }
  return true;
}

describe('2026-10-19 公开发布依赖安全基线', () => {
  it.each([
    ['sharp', '0.35.5'],
    ['fastify', '5.12.6'],
    ['brace-expansion', '5.0.12'],
    ['source-map-js', '1.2.2'],
    ['ip-address', '10.7.1'],
  ])('%s 的所有锁定副本不低于已修复版本 %s', (name, minimum) => {
    const entries = Object.entries(lock.packages).filter(([location]) => location.endsWith(`/node_modules/${name}`) || location === `node_modules/${name}`);
    expect(entries.length).toBeGreaterThan(0);
    for (const [location, item] of entries) expect(atLeast(item.version ?? '', minimum), `${location}@${item.version}`).toBe(true);
  });
  it('fast-uri 的3.x和4.x锁定副本均使用各自安全补丁', () => {
    const entries = Object.entries(lock.packages).filter(([location]) => location.endsWith('/node_modules/fast-uri') || location === 'node_modules/fast-uri');
    expect(entries.length).toBeGreaterThan(0);
    for (const [location, item] of entries) {
      const version = item.version ?? '';
      const minimum = version.startsWith('3.') ? '3.1.8' : '4.1.5';
      expect(atLeast(version, minimum), `${location}@${version}`).toBe(true);
    }
  });
});
