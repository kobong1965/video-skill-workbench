import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const source = 'C:/Users/Administrator/.codex/skills/parking-lot-top';
const target = 'E:/Codex工作盘/artifacts/latest/video-skill-workbench/examples/停车场上衣-原版导入包.zip';
const files: Record<string, Uint8Array> = {};
async function walk(relative = '') {
  for (const file of await readdir(path.join(source, relative), { withFileTypes: true })) {
    if (file.isSymbolicLink()) throw new Error('不复制符号链接');
    const nested = path.posix.join(relative.replaceAll('\\', '/'), file.name);
    if (file.isDirectory()) await walk(nested);
    else if (/\.(md|txt|json|ya?ml|png|jpg|jpeg|webp|mp4)$/i.test(file.name)) files[`parking-lot-top/${nested}`] = await readFile(path.join(source, nested));
  }
}
await walk(); await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, zipSync(files), { flag: 'wx' });
console.log(`原件未修改。已保存可导入包：${target}`);
