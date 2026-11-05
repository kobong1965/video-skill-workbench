import { spawn } from 'node:child_process';
import type { FastifyRequest } from 'fastify';
import { admin, AppError, type Routes } from './context';
import { ProductCatalogStore } from './product-catalog-store';
import { z } from 'zod';
import { catalogSelectionInput, ownedCatalogSelection, selectCatalogProduct } from './catalog-selection-store';

function localAdmin(request: FastifyRequest, singleUserMode?: boolean) {
  admin(request);
  if (!singleUserMode || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) throw new AppError(403, '产品表仅供本机单人工作台管理员使用');
}
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(size - 1, requestedEnd) };
}
async function openLocalFolder(target: string) {
  if (process.platform !== 'win32') throw new AppError(400, '打开本地文件夹仅支持 Windows 工作台');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('explorer.exe', [target], { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new AppError(500, '无法打开资料目录，请稍后重试')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export const registerProductCatalog: Routes = async (app, context) => {
  const store = new ProductCatalogStore(context.dataRoot, context.catalog);
  app.get('/api/product-catalog', async request => { localAdmin(request, context.singleUserMode); return store.snapshot(); });
  app.post('/api/product-catalog/sync', async request => { localAdmin(request, context.singleUserMode); return store.sync(); });
  app.post('/api/product-catalog/selections', async request => {
    localAdmin(request, context.singleUserMode);
    return selectCatalogProduct(context, store, request.user.id, catalogSelectionInput.parse(request.body));
  });
  app.get('/api/product-catalog/selections/:id', async request => {
    localAdmin(request, context.singleUserMode);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ownedCatalogSelection(context.db, id, request.user.id);
  });
  app.get<{ Params: { productUid: string; assetId: string } }>('/api/product-catalog/:productUid/assets/:assetId', async (request, reply) => {
    localAdmin(request, context.singleUserMode);
    const asset = await store.asset(request.params.productUid, request.params.assetId);
    if (!asset) throw new AppError(404, '媒体不可用或已移动，请刷新同步后重试');
    reply.type(asset.mime).header('Accept-Ranges', 'bytes');
    const header = request.headers.range;
    if (header) {
      const range = parseRange(header, asset.size);
      if (!range) { await asset.handle.close(); return reply.code(416).header('Content-Range', `bytes */${asset.size}`).send(); }
      reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`).header('Content-Length', range.end - range.start + 1);
      return reply.send(asset.handle.createReadStream({ start: range.start, end: range.end, autoClose: true }));
    }
    reply.header('Content-Length', asset.size);
    return reply.send(asset.handle.createReadStream({ start: 0, autoClose: true }));
  });
  app.post<{ Params: { productUid: string; folderId: string } }>('/api/product-catalog/:productUid/folders/:folderId/open', async request => {
    localAdmin(request, context.singleUserMode);
    const target = await store.folder(request.params.productUid, request.params.folderId);
    if (!target) throw new AppError(404, '资料目录不存在或已移动，请刷新同步后重试');
    await (context.catalog?.openFolder ?? openLocalFolder)(target);
    return { ok: true };
  });
};
