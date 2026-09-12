let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.details?.length ? `${result.error}：${result.details.join('；')}` : result.error ?? '请求失败');
  return result as T;
}
export async function upload(file: File) { const body = new FormData(); body.set('file', file); return api<{ id: string; name: string; mime: string; size: number }>('/api/media', 'POST', body); }
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch { throw new Error('浏览器未允许复制，请选中文字后按 Ctrl+C'); }
}
export const mediaUrl = (id: string) => `/api/media/${id}`;
