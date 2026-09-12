import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  cacheDir: 'E:/Codex工作盘/caches/video-skill-workbench/vite',
  server: { host: '127.0.0.1', port: 4178, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4179' } },
  build: { outDir: process.env.VSW_OUTPUT_ROOT ?? 'E:/Codex工作盘/artifacts/test-builds/video-skill-workbench/app', emptyOutDir: false, sourcemap: false },
});
