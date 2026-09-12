import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import type { TaskSnapshot, PromptOutput } from '../contracts';
import { batchShots, renderPrompt } from '../domain/planning';
import type { AppContext } from '../../apps/api/context';
import { AppError } from '../../apps/api/context';
import { boundAssets, missingAssets } from '../../apps/api/asset-service';
import { ownedMedia, mediaBytes } from './private-files';
import { batchMediaIds, referenceRoleLabels } from '../domain/references';

export async function makeBundle(context: AppContext, ownerId: string, taskId: string, resultId: string, snapshot: TaskSnapshot, output: PromptOutput, complete: boolean, confirmed: boolean) {
  const bound = await boundAssets(context, taskId, resultId);
  const missing = missingAssets(snapshot, output, bound);
  if (complete && (!confirmed || missing.length)) throw new AppError(409, !confirmed ? '请先确认脚本' : `完整包尚缺：${missing.join('、')}`);
  const references = [
    ...snapshot.media.map(x => ({ id: x.id, kind: x.role, name: x.name, batch: null as number | null, assetId: null as string | null })),
    ...bound.filter(x => !x.stale).map(x => ({ id: x.mediaId, kind: x.kind, name: x.name, batch: x.batch, assetId: x.id })),
  ];
  const files: Record<string, Uint8Array> = {};
  const materials: { id: string; kind: string; name: string; batch: number | null; assetId: string | null; file: string; sha256: string }[] = []; let size = 0;
  for (const [index, reference] of references.entries()) {
    const media = await ownedMedia(context, reference.id, ownerId);
    const bytes = await mediaBytes(context, media); size += bytes.length;
    if (size > 120 * 1024 * 1024) throw new AppError(400, '素材总量超过单包 120 MB，请逐张下载图片');
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[media.mime] ?? 'bin';
    const file = `images/${String(index + 1).padStart(2, '0')}-${reference.kind}-${reference.id}.${extension}`;
    files[file] = new Uint8Array(bytes);
    materials.push({ ...reference, file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const batches = batchShots(output.shots, snapshot.capability).map(batch => {
    const requestedMedia = batchMediaIds(snapshot, batch.shots);
    const refs = materials.filter(x => x.assetId ? x.batch === null || x.batch === batch.number : requestedMedia.has(x.id));
    const roleList = refs.map((ref, index) => `${index + 1}. ${ref.file}｜${referenceRoleLabels[ref.kind] || ref.kind}｜${ref.name}`).join('\n');
    const suffix = `\n\n本批参考图上传顺序与用途：\n${roleList}\n\n${batch.note}\n画面由所列产品及已确认参考决定；预览视频不属于必须上传素材。`;
    const prompt = renderPrompt(output, batch.shots) + suffix;
    const file = `batches/${String(batch.number).padStart(2, '0')}-prompt.txt`;
    files[file] = strToU8(prompt);
    return { number: batch.number, duration: batch.duration, generationDuration: batch.generationDuration, promptFile: file, references: refs.map(x => ({ file: x.file, kind: x.kind, assetId: x.assetId })) };
  });
  const manifest = { formatVersion: 1, taskId, resultId, complete, missing, market: snapshot.input.market, model: snapshot.input.model, capability: snapshot.capability, skillVersions: snapshot.skills.map(s => ({ id: s.id, versionId: s.versionId, name: s.name, duration: s.duration })), materials, batches };
  files['prompt.txt'] = strToU8(renderPrompt(output));
  files['storyboard.md'] = strToU8(output.shots.map((shot, index) => `## 镜头 ${index + 1} · ${shot.duration} 秒\n\n${shot.prompt}\n\n开始：${shot.startState}\n结束：${shot.endState}\n\n台词：${shot.dialogue}\n中文意思：${shot.translation}\n剧情声音：${shot.storyAudio}`).join('\n\n'));
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['使用说明.txt'] = strToU8(`视频 Skill 工作台导出\n${complete ? '完整资料包' : '部分资料包：不代表图片已齐全'}\n尚缺：${missing.join('、') || '无'}\n每批独立复制 batches 内的提示词，按 manifest.json 所列顺序上传参考图。\n提示词语言默认中文，台词按市场单独输出。\n模型能力${snapshot.capability.verified ? '已由管理员核验' : '尚未由管理员核验，请核对实际画布限制'}。\n此包没有生成视频或真实音频。画面、发音与商品一致性仍需在外部平台生成后审阅。\n不包括库中仅供预览的视频、原始 Skill 包或接口密钥。`);
  return { bytes: Buffer.from(zipSync(files, { level: 0 })), manifest };
}
