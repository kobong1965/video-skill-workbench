import type { CreationInput } from '../../../../packages/contracts';

export function CreationSettings({ value, update, onDuration }: { value: CreationInput; update: (patch: Partial<CreationInput>) => void; onDuration: () => void }) {
  return <div className="creation-settings form-stack">
    <section className="form-stack" aria-label="常规设置">
      <h3>常规设置</h3>
      <div className="field-grid three">
        <label>发布平台<select value={value.platform} onChange={e => update({ platform: e.target.value as CreationInput['platform'] })}><option value="douyin">抖音</option><option value="tiktok">TikTok</option></select></label>
        <label>目标市场<select value={value.market} onChange={e => update({ market: e.target.value as CreationInput['market'] })}><option value="CN">中国</option><option value="US">美国</option><option value="VN">越南</option></select></label>
        <label>商品类目<input required value={value.category} onChange={e => update({ category: e.target.value })} maxLength={50}/></label>
        <label>目标视频时长（秒）<input required type="number" min="1" max="300" step="any" value={value.targetDuration} onChange={e => { onDuration(); update({ targetDuration: Number(e.target.value) }); }}/></label>
        <label>使用的生成模型<select value={value.model} onChange={e => update({ model: e.target.value as CreationInput['model'] })}><option value="seedance-2.5">Seedance 2.5</option><option value="seedance-2.0">Seedance 2.0</option></select></label>
        <label>声音方式<select value={value.voice} onChange={e => update({ voice: e.target.value as CreationInput['voice'] })}><option value="inherit">沿用脚本</option><option value="none">无广告配音</option><option value="voiceover">画外配音＋同文字幕</option><option value="onscreen">人物出镜口播</option></select></label>
      </div>
      <div className="checkbox-row"><label className="check-label creation-asset-switch"><input type="checkbox" checked={value.generatePerson} onChange={e => update({ generatePerson: e.target.checked })}/><span className="creation-switch-track" aria-hidden="true"/>人物参考图</label><label className="check-label creation-asset-switch"><input type="checkbox" checked={value.generateScene} onChange={e => update({ generateScene: e.target.checked })}/><span className="creation-switch-track" aria-hidden="true"/>场景参考图</label></div>
    </section>
    <details className="advanced creation-advanced"><summary>高级设置</summary><div className="form-stack">
      <div className="field-grid"><label>商品名称<input value={value.productName} onChange={e => update({ productName: e.target.value })}/></label><label>适合人群<input value={value.audience} onChange={e => update({ audience: e.target.value })}/></label></div>
      <label>商品信息<textarea value={value.facts} onChange={e => update({ facts: e.target.value })}/></label>
      <div className="field-grid"><label>人物补充要求<textarea value={value.personNotes} onChange={e => update({ personNotes: e.target.value })}/></label><label>场景补充要求<textarea value={value.sceneNotes} onChange={e => update({ sceneNotes: e.target.value })}/></label></div>
      <label>其他要求<textarea value={value.extra} onChange={e => update({ extra: e.target.value })}/></label>
    </div></details>
  </div>;
}
