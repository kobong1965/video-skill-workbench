import type { TaskSnapshot } from '../contracts';
import type { CanvasProductBinding } from './contracts';

/** Only saved identities are eligible. Never infer a binding for a legacy task. */
export function canvasProductBindings(snapshot: TaskSnapshot): CanvasProductBinding[] {
  return (snapshot.input?.productGroups ?? []).flatMap((group, index) => {
    if (group.source !== 'catalog') return [];
    const catalog = group.catalog;
    if (!catalog || catalog.selectionId !== group.catalogSelectionId || !catalog.productUid
      || typeof catalog.binding?.productId !== 'string' || !/^\d{19}$/.test(catalog.binding.productId)
      || !catalog.binding.shopName || catalog.binding.market !== 'US') {
      throw new Error(`款号 ${group.styleNumber} 的商品绑定快照缺失或无效，请核对任务资料，不能猜测商品 ID`);
    }
    return [{ groupNumber: index + 1, selectionId: catalog.selectionId, productUid: catalog.productUid,
      category: catalog.category, sku: catalog.sku, name: catalog.name,
      shopName: catalog.binding.shopName, market: catalog.binding.market, productId: catalog.binding.productId,
      sourceHash: catalog.sourceHash, sourceUpdatedAt: catalog.sourceUpdatedAt, selectedAt: catalog.selectedAt }];
  });
}

export function productRecordText(importId: string, bindings: CanvasProductBinding[]): string {
  return [`商品资料记录（仅供追溯，不连接视频生成输入）`, `导入记录：${importId}`,
    ...bindings.map(binding => [
      `商品组 ${binding.groupNumber}｜${binding.category === 'men' ? '男装' : '女装'}`,
      `店铺：${binding.shopName}｜市场：${binding.market}`, `款号：${binding.sku}`, `名称：${binding.name}`,
      `商品 ID：${binding.productId}`, `产品身份：${binding.productUid}`, `选用记录：${binding.selectionId}`,
      `选用时间：${binding.selectedAt}`, `来源更新时间：${binding.sourceUpdatedAt}`, `来源修订：${binding.sourceHash}`,
    ].join('\n'))].join('\n\n');
}

/** Split only between complete fields, so long product names cannot split a product ID. */
export function productRecordChunks(content: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (content.length - offset > 10000) {
    const end = content.lastIndexOf('\n', offset + 9999) + 1;
    if (end <= offset) throw new Error('商品资料单个字段过长，请核对产品名称后重试');
    chunks.push(content.slice(offset, end)); offset = end;
  }
  if (offset < content.length) chunks.push(content.slice(offset));
  return chunks;
}
