import sharp from 'sharp';
import { ProviderError } from './network';

export const MAX_TEXT_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_ANALYSIS_IMAGE_BYTES = 512 * 1024;

export function assertTextRequestBytes(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_TEXT_REQUEST_BYTES) {
    throw new ProviderError('rejected', '图片与脚本请求体超过本机 32 MiB 发送上限，尚未发送；请减少参考图或拆分任务，原图及草稿保持不变');
  }
}

/** Only an in-memory analysis copy is changed. Saved product originals remain intact. */
export async function prepareVisionImage(bytes: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string }> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (bytes.length <= MAX_ANALYSIS_IMAGE_BYTES && metadata.width && metadata.height && Math.max(metadata.width, metadata.height) <= 1600 && !metadata.orientation) return { bytes, mime };
    for (const quality of [82, 68, 52]) {
      const image = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      if (image.length <= MAX_ANALYSIS_IMAGE_BYTES) return { mime: 'image/jpeg', bytes: image };
    }
    const image = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
    if (image.length > MAX_ANALYSIS_IMAGE_BYTES) throw new Error('analysis image too large');
    return { mime: 'image/jpeg', bytes: image };
  } catch {
    throw new ProviderError('rejected', '商品图片无法制备分析副本，尚未发送请求；请检查图片文件，原素材未改动');
  }
}
