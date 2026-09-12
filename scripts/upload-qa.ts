import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { freePort } from './postgres';
const project = 'E:/Codex工作盘/projects/video-skill-workbench';
const server = await createServer({ configFile: false, root: project, cacheDir: 'E:/Codex工作盘/caches/video-skill-workbench/upload-qa-vite', plugins: [react()], server: { host: '127.0.0.1', port: await freePort(), strictPort: true } });
await server.listen();
console.log(`${server.resolvedUrls!.local[0]}tests/fixtures/upload-qa.html`);
process.on('SIGINT', () => void server.close());
process.on('SIGTERM', () => void server.close());
