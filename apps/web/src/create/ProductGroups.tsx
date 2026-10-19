import type { CreationInput, ProductUse } from '../../../../packages/contracts';
import { Icon } from '../ui';
import './product-groups.css';

export function ProductGroups({ input, disabled, onUse, onMove, onRemove }: {
  input: CreationInput; disabled: boolean; onUse: (use: ProductUse) => void;
  onMove: (index: number, direction: number) => void; onRemove: (index: number) => void;
}) {
  const groups = input.productGroups ?? [];
  if (!groups.length) return null;
  return <div className="creation-product-groups">
    {groups.length > 1 ? <fieldset className="creation-product-use" disabled={disabled}>
      <legend>商品用途</legend><div className="inline">{([['colors', '换色'], ['outfit', '搭配'], ['comparison', '对比']] as const).map(([value, label]) => <label key={value} className={`check-label product-use-choice${input.productUse === value ? ' selected' : ''}`}><input type="radio" name="product-use" value={value} checked={input.productUse === value} onChange={() => onUse(value)}/>{label}</label>)}</div>
      <small>{input.productUse === 'comparison' ? '第 1 组为主商品，其余为对比商品。' : input.productUse === 'outfit' ? '不同商品搭配展示，各组保留独立外观。' : '由你声明同款不同色，不按款号自动判断。'}</small>
    </fieldset> : null}
    <ol className="product-set-selected-order creation-group-order" aria-label="本次款号">{groups.map((group, index) => <li key={group.productSetId}>
      <span><b>{index + 1}</b><span className="creation-group-name">{group.styleNumber}<small>{input.productUse === 'comparison' ? index === 0 ? '主商品' : '对比商品' : group.name || '商品'} · {group.mediaIds.length} 张</small></span></span>
      <div className="inline"><button type="button" aria-label={`上移款号：${group.styleNumber}`} disabled={disabled || index === 0} onClick={() => onMove(index, -1)}>↑</button><button type="button" aria-label={`下移款号：${group.styleNumber}`} disabled={disabled || index === groups.length - 1} onClick={() => onMove(index, 1)}>↓</button><button type="button" aria-label={`移除款号：${group.styleNumber}`} disabled={disabled} onClick={() => onRemove(index)}><Icon name="close"/></button></div>
    </li>)}</ol>
  </div>;
}
