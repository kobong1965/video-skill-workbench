import yauzl from 'yauzl';
import path from 'node:path';
import { getSkillRequirements } from './skill-requirements';

const MAX_TOTAL = 200 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);
const allowed = new Set([...textExtensions, '.png', '.jpg', '.jpeg', '.webp', '.mp4']);
const mimes: Record<string, string> = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.yaml': 'text/plain', '.yml': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };
export interface PackageFile { path: string; mime: string; text?: string; bytes: Buffer; }
export interface ParsedPackage { text: string; mainPath: string; files: PackageFile[]; missing: string[]; suggestedName: string; suggestedDuration: number | null; suggestedKind: string; }

function safePath(name: string) {
  if (!name || name.length > 250 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('压缩包包含危险路径');
  return name;
}
function decode(bytes: Buffer) {
  if (bytes.length > MAX_TEXT) throw new Error('脚本文本过大');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}
async function unzip(bytes: Buffer) {
  return new Promise<PackageFile[]>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('压缩包无效'));
      const files: PackageFile[] = []; const paths = new Set<string>();
      let total = 0; let textSize = 0; let count = 0; let failed = false;
      const fail = (reason: Error) => { if (failed) return; failed = true; zip.close(); reject(reason); };
      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(files); });
      zip.on('entry', entry => {
        try {
          if (++count > 300) throw new Error('压缩包文件数超过 300');
          const name = safePath(entry.fileName);
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('不允许符号链接');
          if (entry.generalPurposeBitFlag & 1) throw new Error('不支持加密压缩包');
          if (name.endsWith('/')) { zip.readEntry(); return; }
          if (paths.has(name.toLowerCase())) throw new Error('压缩包存在重复路径');
          paths.add(name.toLowerCase());
          const extension = path.posix.extname(name).toLowerCase();
          if (!allowed.has(extension)) throw new Error(`不允许执行文件或不支持的文件类型：${extension}`);
          if (entry.uncompressedSize > 150 * 1024 * 1024 || total + entry.uncompressedSize > MAX_TOTAL) throw new Error('压缩包解压容量超过限制');
          if (entry.uncompressedSize > 1024 * 1024 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 300) throw new Error('压缩比异常');
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail(streamError ?? new Error('无法读取包内文件'));
            const chunks: Buffer[] = []; let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length; total += chunk.length;
              if (size > entry.uncompressedSize || total > MAX_TOTAL) { stream.destroy(); fail(new Error('实际解压容量超过限制')); return; }
              chunks.push(chunk);
            });
            stream.on('end', () => {
              try {
                const bytes = Buffer.concat(chunks); let text: string | undefined;
                if (textExtensions.has(extension)) { textSize += bytes.length; if (textSize > MAX_TEXT) throw new Error('包内文本总量超过限制'); text = decode(bytes); }
                files.push({ path: name, mime: mimes[extension], text, bytes });
                if (!failed) zip.readEntry();
              } catch (e) { fail(e as Error); }
            });
          });
        } catch (e) { fail(e as Error); }
      });
      zip.readEntry();
    });
  });
}

export function findMissingReferences(files: { path: string; text?: string | null }[]) {
  const missing = new Set<string>();
  for (const file of files.filter(x => x.text && /\.md$/i.test(x.path))) {
    for (const match of file.text!.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const ref = match[1].replace(/^<|>$/g, '');
      if (/^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith('#')) continue;
      const decoded = decodeURIComponent(ref.split('#')[0]);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), decoded));
      safePath(resolved);
      if (!files.some(x => x.path === resolved)) missing.add(resolved);
    }
  }
  return [...missing];
}

export async function parseSkillPackage(bytes: Buffer, name: string): Promise<ParsedPackage> {
  if (bytes.length > 150 * 1024 * 1024) throw new Error('导入文件超过 150 MB');
  const ext = path.extname(name).toLowerCase();
  if (!['.md', '.zip'].includes(ext)) throw new Error('请选择 ZIP Skill 包或 Markdown 文件');
  const files = ext === '.md' ? [{ path: path.basename(name), mime: 'text/markdown', text: decode(bytes), bytes }] : await unzip(bytes);
  const main = files.find(x => /(^|\/)SKILL\.md$/i.test(x.path)) ?? files.find(x => /\.md$/i.test(x.path));
  if (!main?.text) throw new Error('包内没有可读取的 Markdown 脚本');
  getSkillRequirements(files);
  const missing = findMissingReferences(files);
  const heading = main.text.match(/^#\s+(.+)$/m)?.[1]?.replace(/\*\*/g, '').trim();
  const duration = main.text.match(/(?:默认(?:时长)?|约|总时长)\s*[*：:]?\s*(\d+(?:\.\d+)?)\s*秒/);
  return { text: main.text, mainPath: main.path, files, missing: [...missing], suggestedName: heading ?? name.replace(/\.(md|zip)$/i, ''), suggestedDuration: duration ? Number(duration[1]) : null, suggestedKind: /全片|贯穿|九镜头/.test(main.text) ? 'full' : 'opening' };
}
