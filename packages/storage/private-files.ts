import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError, type AppContext } from '../../apps/api/context';

export async function inspectMedia(name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > 150 * 1024 * 1024) throw new AppError(400, '文件为空或超过 150 MB');
  const ext = path.extname(name).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    if (bytes.length > 20 * 1024 * 1024) throw new AppError(400, '单张图片不能超过 20 MB');
    const image = sharp(bytes, { limitInputPixels: 40000000, failOn: 'error' });
    const metadata = await image.metadata().catch(() => { throw new AppError(400, '图片内容损坏或格式不正确'); });
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new AppError(400, '仅支持静态 PNG、JPG、WEBP 图片');
    await image.stats().catch(() => { throw new AppError(400, '图片解码失败'); });
    return ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[metadata.format];
  }
  if (ext === '.mp4' && bytes.subarray(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (ext === '.zip' && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'application/zip';
  if (ext === '.md' && bytes.length <= 2 * 1024 * 1024) {
    try { new TextDecoder('utf8', { fatal: true }).decode(bytes); return 'text/markdown'; } catch { /* reject below */ }
  }
  throw new AppError(400, '不支持此文件，或文件扩展名与内容不符');
}
export async function saveMedia(context: AppContext, ownerId: string, originalName: string, bytes: Buffer) {
  const name = path.basename(originalName).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
  const mime = await inspectMedia(name, bytes);
  const id = randomUUID();
  const diskPath = path.join('media', id);
  await mkdir(path.join(context.dataRoot, 'media'), { recursive: true });
  await writeFile(path.join(context.dataRoot, diskPath), bytes, { flag: 'wx', mode: 0o600 });
  const digest = createHash('sha256').update(bytes).digest('hex');
  await context.db.query('INSERT INTO media(id,owner_id,name,mime,size,digest,disk_path) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, ownerId, name, mime, bytes.length, digest, diskPath]);
  return { id, name, mime, size: bytes.length, digest };
}
export async function ownedMedia(context: AppContext, id: string, ownerId: string) {
  const row = (await context.db.query('SELECT * FROM media WHERE id=$1 AND owner_id=$2', [id, ownerId])).rows[0];
  if (!row) throw new AppError(404, '素材不存在或无权访问');
  return row as { id: string; owner_id: string; name: string; mime: string; size: string; digest: string; disk_path: string };
}
export async function mediaBytes(context: AppContext, row: { disk_path: string }) {
  const absolute = path.resolve(context.dataRoot, row.disk_path);
  if (!absolute.startsWith(path.resolve(context.dataRoot) + path.sep)) throw new AppError(400, '媒体路径无效');
  return readFile(absolute);
}
