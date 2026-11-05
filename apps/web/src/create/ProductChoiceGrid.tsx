import { Icon } from '../ui';
import { optionLabel, type PickerOption } from '../products/picker-options';

export function ProductChoiceGrid({ options, selected, disabled, toggle }: {
  options: PickerOption[]; selected: PickerOption[]; disabled: boolean; toggle: (option: PickerOption) => void;
}) {
  return <div className="product-set-choice-grid">{options.map(option => {
    const order = selected.findIndex(item => item.key === option.key);
    return <button key={option.key} className={`product-set-choice${order >= 0 ? ' selected' : ''}`}
      disabled={disabled || Boolean(option.disabledReason)} aria-label={`选择款号：${optionLabel(option)}`} aria-pressed={order >= 0} onClick={() => toggle(option)}>
      {option.coverUrl ? <img src={option.coverUrl} alt="" loading="lazy"/> : <Icon name="image"/>}
      {order >= 0 ? <span className="product-set-order" aria-label={`已选第 ${order + 1} 组`}>{order + 1}<Icon name="check"/></span> : null}
      <strong>{option.styleNumber}</strong>{option.name ? <span>{option.name}</span> : null}
      {option.source === 'catalog' ? <><small>{option.category === 'women' ? '女装' : '男装'} · {option.binding?.shopName ?? '未绑定店铺'}</small><small className="picker-product-id">商品 ID：{option.binding?.productId || '未提供'}</small></> : <small>手动图套</small>}
      <small>{option.imageKeys.length} 张{option.disabledReason ? ` · ${option.disabledReason}` : ''}</small>
    </button>;
  })}</div>;
}
