import type { CreationInput, SelectedSkill } from '../../../../packages/contracts';

export function SelectedSkills({ items, combine, disabled, update }: {
  items: SelectedSkill[];
  combine: boolean;
  disabled: boolean;
  update: (selections: CreationInput['selections']) => void;
}) {
  function move(index: number, direction: number) {
    const next = items.map(({ id, versionId, duration }) => ({ id, versionId, duration }));
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    update(next);
  }
  return <section className="creation-selected-skills" aria-label="已选 Skill">
    {items.map((item, index) => <div className="creation-selected-item" key={item.versionId}>
      <span>{combine ? `${index + 1}. ` : ''}{item.name}</span>
      {combine ? <div className="inline">
        <input aria-label={`${item.name}时长`} required type="number" min="0.5" step="any" value={item.duration} disabled={disabled} onChange={e => update(items.map(({ id, versionId, duration }) => ({ id, versionId, duration: versionId === item.versionId ? Number(e.target.value) : duration })))}/>
        <button type="button" className="text-button" aria-label={`上移${item.name}`} disabled={disabled || !index} onClick={() => move(index, -1)}>上移</button>
        <button type="button" className="text-button" aria-label={`下移${item.name}`} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>下移</button>
        <button type="button" className="text-button" aria-label={`移除${item.name}`} disabled={disabled} onClick={() => update(items.filter(value => value.versionId !== item.versionId).map(({ id, versionId, duration }) => ({ id, versionId, duration })))}>移除</button>
      </div> : <small>{Math.round(item.duration * 100) / 100} 秒</small>}
    </div>)}
  </section>;
}
