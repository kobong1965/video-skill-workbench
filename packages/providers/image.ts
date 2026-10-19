import type { AppContext } from '../../apps/api/context';
import { ownedMedia, mediaBytes } from '../storage/private-files';
import { decryptSecret, effectiveProviderTimeout, type ProviderConfig } from './config';
import { ProviderError, requestBytes } from './network';

export async function generateImage(context: AppContext, ownerId: string, payload: Record<string, unknown>, config: ProviderConfig, onDispatch?: () => Promise<void>) {
  const refs = payload.referenceMediaIds as string[];
  if (refs.length && !config.references && !context.singleUserMode) throw new ProviderError('rejected', '图片接口未确认支持参考图编辑');
  if (refs.length > 1 && !config.multiReference && !context.singleUserMode) throw new ProviderError('rejected', '图片接口未确认支持多参考图');
  const headers = { Authorization: `Bearer ${decryptSecret(config.sealedKey, context.masterKey)}` };
  let body: string | FormData; let endpoint: string;
  if (refs.length) {
    const form = new FormData(); form.set('model', config.model); form.set('prompt', String(payload.prompt)); form.set('n', '1');
    for (const id of refs) {
      const file = await ownedMedia(context, id, ownerId);
      const bytes = await mediaBytes(context, file);
      form.append(refs.length > 1 ? 'image[]' : 'image', new Blob([new Uint8Array(bytes)], { type: file.mime }), file.name);
    }
    body = form; endpoint = 'edits';
  } else { body = JSON.stringify({ model: config.model, prompt: payload.prompt, n: 1 }); endpoint = 'generations'; }
  const raw = await requestBytes(`${config.baseUrl.replace(/\/$/, '')}/images/${endpoint}`, { method: 'POST', headers: { ...headers, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) }, body, onDispatch, timeoutSeconds: effectiveProviderTimeout(config.timeoutSeconds, context.singleUserMode), singleUserMode: context.singleUserMode, maxBytes: 40 * 1024 * 1024 });
  let first;
  try { first = JSON.parse(raw.toString('utf8')).data?.[0]; } catch { throw new ProviderError('invalid', '图片接口返回无效 JSON'); }
  if (typeof first?.b64_json === 'string') return Buffer.from(first.b64_json, 'base64');
  if (typeof first?.url === 'string') {
    try {
      const url = new URL(first.url);
      if (![new URL(config.baseUrl).hostname, ...config.outputHosts].includes(url.hostname)) throw new Error('下载域名尚未获管理员允许');
      return await requestBytes(first.url, { maxBytes: 20 * 1024 * 1024, timeoutSeconds: 60, allowSignedQuery: true, singleUserMode: context.singleUserMode });
    } catch {
      // The paid generation POST already returned an image envelope. A rejected
      // download is not a rejected generation and must not release its budget.
      throw new ProviderError('invalid', context.singleUserMode ? '图片已在上游生成，但下载未完成。请检查中转站与网络连接后重试' : '图片已在上游生成，但下载未完成。本次生成额度已记账；请先核对上游图片，重新生成会再次产生费用', raw.toString('utf8').slice(0, 150000));
    }
  }
  throw new ProviderError('invalid', '图片接口没有返回可保存的图片');
}
