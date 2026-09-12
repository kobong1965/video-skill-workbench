import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

describe('shared snail branding assets', () => {
  it('keeps the web logo square and compact', async () => {
    const logo = await readFile('apps/web/src/assets/brand-logo.png');
    const metadata = await sharp(logo).metadata();
    expect([metadata.width, metadata.height]).toEqual([256, 256]);
    expect(logo.length).toBeLessThan(100_000);
    const expected = await sharp('desktop/branding/logo-source.png').resize(256, 256).png().raw().toBuffer();
    expect(await sharp(logo).raw().toBuffer()).toEqual(expected);
  });

  it('provides valid icon frames for small desktop icons and high DPI displays', async () => {
    const ico = await readFile('desktop/branding/workbench.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    expect(ico.readUInt16LE(4)).toBe(sizes.length);
    let nextOffset = 6 + sizes.length * 16;
    for (const [i, size] of sizes.entries()) {
      const entry = 6 + i * 16;
      expect(ico[entry] || 256).toBe(size);
      expect(ico[entry + 1] || 256).toBe(size);
      const bytes = ico.readUInt32LE(entry + 8);
      expect(ico.readUInt32LE(entry + 12)).toBe(nextOffset);
      const frame = ico.subarray(nextOffset, nextOffset + bytes);
      const metadata = await sharp(frame).metadata();
      expect([metadata.width, metadata.height, metadata.format]).toEqual([size, size, 'png']);
      nextOffset += bytes;
    }
    expect(nextOffset).toBe(ico.length);
  });
});
