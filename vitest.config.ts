import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    reporters: ['default', 'json'],
    outputFile: 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/tests/results.json',
  },
});
