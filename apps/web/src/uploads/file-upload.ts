export type UploadKind = 'image' | 'skill' | 'preview';
const imageExtensions = ['png', 'jpg', 'jpeg', 'webp'];
export const uploadAccept: Record<UploadKind, string> = {
  image: '.png,.jpg,.jpeg,.webp', skill: '.zip,.md', preview: '.mp4,.png,.jpg,.jpeg,.webp',
};
export const uploadHint: Record<UploadKind, string> = {
  image: 'PNG / JPG / WEBP · 单张不超过 20 MB',
  skill: 'ZIP ≤ 150 MB / Markdown ≤ 2 MB',
  preview: 'MP4 ≤ 150 MB / PNG、JPG、WEBP ≤ 20 MB',
};

/** Client-side convenience checks; the server still inspects actual bytes. */
export function validateUploadFiles(files: readonly File[], kind: UploadKind, maxFiles = 1): File[] {
  if (!files.length) return [];
  if (maxFiles < 1) throw new Error('图片数量已达上限，请先移除不需要的图片。');
  if (files.length > maxFiles) throw new Error(`此处最多再选择 ${maxFiles} 个文件，本次未上传，请重新选择。`);
  const allowed = uploadAccept[kind].split(',').map(x => x.slice(1));
  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!allowed.includes(extension)) throw new Error(`${file.name}：格式不支持。${uploadHint[kind]}。`);
    if (!file.size) throw new Error(`${file.name}：文件为空，请重新选择。`);
    const limit = imageExtensions.includes(extension) ? 20 : extension === 'md' ? 2 : 150;
    if (file.size > limit * 1024 * 1024) throw new Error(`${file.name}：超过 ${limit} MB，请缩小后再上传。`);
  }
  return [...files];
}

export function isFileDrag(transfer: { types: readonly string[] } | null) {
  return Boolean(transfer?.types.includes('Files'));
}
export function droppedFiles(transfer: DataTransfer): File[] {
  for (const item of Array.from(transfer.items)) {
    if (item.webkitGetAsEntry?.()?.isDirectory) throw new Error('暂不支持拖入文件夹，请选择文件夹中的具体文件。');
  }
  const files = Array.from(transfer.files);
  if (!files.length) throw new Error('无法读取拖入的文件。请先保存到本机，或点击选择文件。');
  return files;
}

export async function uploadSequentially<T>(files: readonly File[], save: (file: File) => Promise<T>, onSaved: (saved: T) => void) {
  let succeeded = 0; const failures: string[] = [];
  for (const file of files) {
    try { const saved = await save(file); onSaved(saved); succeeded++; }
    catch (error) { failures.push(`${file.name}：${error instanceof Error ? error.message : '上传失败'}`); }
  }
  return { succeeded, failures };
}
