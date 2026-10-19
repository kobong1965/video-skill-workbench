import { textProviderReady } from '../admin/provider-pool';
import { useState, useEffect, useRef } from 'react';
import { MAX_TASK_IMAGES, type CreationInput, type ProductImageSet, type ProductGroup, type ProductUse, type SkillInfo } from '../../../../packages/contracts';
import { api, upload, mediaUrl } from '../api';
import { useLoad, useWorkspace, type CreationStart } from '../workspace';
import { Icon, Message, Empty, Modal, ControlHint } from '../ui';
import { CreationSettings } from './CreationSettings';
import { SelectedSkills } from './SelectedSkills';
import { useDraft } from './useDraft';
import { FileDropzone } from '../uploads/FileDropzone';
import { uploadSequentially } from '../uploads/file-upload';
import { planSelection } from '../../../../packages/domain/planning';
import { SkillSelectionCard } from './SkillSelectionCard';
import { ReferenceVideoNotice } from '../skills/ReferenceVideoNotice';
import { useReferenceVideoRequirement } from './useReferenceVideoRequirement';
import { ProductSetPicker } from './ProductSetPicker';
import { productSetsPatch, productUsePatch, productGroupsError, removeProductImage } from '../products/product-set-selection';
import { ProductGroups } from './ProductGroups';
import './creation.css';

const isCreationRoute = () => !location.hash || location.hash === '#' || location.hash === '#create';

export function Creation({ initial: supplied }: { initial: CreationStart }) {
  const { _draftId, ...initial } = supplied;
  const { config, preferences, navigate, notify, start, registerDraftSaver, user } = useWorkspace();
  const singleUser = config.singleUserMode === true;
  const [input, setInput] = useState<CreationInput>(() => ({ name: '', media: [], platform: (preferences.platform as CreationInput['platform']) || 'douyin', market: (preferences.market as CreationInput['market']) || 'CN', category: preferences.category || '服装', targetDuration: 17, model: (preferences.model as CreationInput['model']) || 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'inherit', selections: [], productName: '', facts: '', audience: '', personNotes: '', sceneNotes: '', extra: '', ...initial }));
  const [files, setFiles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [combine, setCombine] = useState((initial.selections?.length ?? 0) > 1);
  const [followDuration, setFollowDuration] = useState(!initial.targetDuration);
  const submitting = useRef(false);
  const changingProducts = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { data: skills, error: libraryError, loading, refresh: refreshSkills } = useLoad<SkillInfo[]>('/api/skills');
  const references = useReferenceVideoRequirement(input.selections, skills);
  const [previousSelection, setPreviousSelection] = useState<Pick<CreationInput, 'selections' | 'targetDuration'> | null>(null);
  const draft = useDraft(input as unknown as Record<string, unknown>, Boolean(input.media.length || input.selections.length || input.extra || input.name), _draftId);
  useEffect(() => { registerDraftSaver(draft.save); return () => registerDraftSaver(null); }, [draft.save, registerDraftSaver]);
  useEffect(() => { const refresh = () => { if (isCreationRoute()) void refreshSkills(); }; window.addEventListener('hashchange', refresh); return () => window.removeEventListener('hashchange', refresh); }, [refreshSkills]);
  const update = (patch: Partial<CreationInput>) => setInput(value => ({ ...value, ...patch }));
  const selected = input.selections.map(item => {
    const skill = skills?.find(x => x.versionId === item.versionId) ?? skills?.find(x => x.id === item.id);
    return { ...item, name: skill?.name ?? '已保存脚本版本', kind: skill?.kind ?? 'opening' as const };
  });
  let selectionError = ''; let duration = 0;
  try { duration = planSelection(selected, input.targetDuration).selectedDuration; } catch (e) { selectionError = (e as Error).message; }
  const quota = config.quotas.find(x => x.kind === 'text');
  const available = quota ? Math.max(0, quota.allowance - quota.used - quota.reserved) : 0;
  const missingConfig = !textProviderReady(config.providerPools?.text, config.text, singleUser);
  const groupsError = productGroupsError(input);
  const nextDisabled = busy || !input.media.some(x => x.role === 'product') || !selected.length || Boolean(references.reason || groupsError);
  const nextHint = groupsError || (!input.media.some(x => x.role === 'product') ? '请先上传商品图' : !selected.length ? '请选择一个或多个脚本' : references.reason || '');
  const reason = groupsError || references.reason || (!input.media.some(x => x.role === 'product') ? '请上传主商品图' : !selected.length ? '请选择 Skill' : selectionError || (!input.category.trim() ? '请填写商品类目' : missingConfig ? '请配置文字／视觉接口' : !singleUser && available < 1 ? '文字额度不足' : ''));
  const visibleSkills = skills ?? [];
  const groupLabels = new Map<string, string[]>();
  input.productGroups?.forEach(group => group.mediaIds.forEach(id => groupLabels.set(id, [...(groupLabels.get(id) ?? []), group.styleNumber])));

  function loadProductSets(sets: ProductImageSet[]) {
    if (!mounted.current || !isCreationRoute()) return;
    const use = sets.length > 1 ? input.productUse ?? 'colors' : 'colors';
    const patch = productSetsPatch(sets, use, input);
    if ((input.facts || input.extra) && !patch.facts && !patch.extra) notify('已调整款号，上一组商品信息和其他要求已清空');
    setInput(value => ({ ...value, ...patch, name: '' }));
    setFiles(Object.fromEntries(sets.flatMap(set => set.media).map(file => [file.id, file.name])));
    setProductPickerOpen(false);
  }

  async function changeProducts(groups: ProductGroup[], use: ProductUse, removeIds: string[] = []) {
    if (changingProducts.current || busy) return;
    changingProducts.current = true; setBusy(true); setError('');
    try {
      const stillUsed = new Set(groups.flatMap(group => group.mediaIds));
      const media = input.media.filter(file => !removeIds.includes(file.id) || stillUsed.has(file.id));
      const nextUse = groups.length > 1 ? use : 'colors';
      const canonical = await Promise.all(groups.map(group => api<ProductImageSet>(`/api/product-sets/${group.productSetId}`)));
      const patch = groups.length ? productUsePatch({ ...input, media, productGroups: groups }, nextUse, canonical) : { media, productGroups: undefined, productUse: undefined };
      if (!mounted.current || !isCreationRoute()) return;
      setInput(value => ({ ...value, ...patch, productSetId: groups.length === 1 ? groups[0].productSetId : undefined, styleNumber: groups.length === 1 ? groups[0].styleNumber : undefined, productName: groups.map(group => group.name || group.styleNumber).join(' / ').slice(0, 100), name: '', facts: '', extra: '' }));
      if (input.facts || input.extra) notify('已调整商品顺序或用途，商品信息和其他要求已清空');
    } catch (failure) { if (mounted.current) setError((failure as Error).message); }
    finally { changingProducts.current = false; if (mounted.current) setBusy(false); }
  }
  function moveProduct(index: number, direction: number) {
    const groups = [...(input.productGroups ?? [])];
    [groups[index], groups[index + direction]] = [groups[index + direction], groups[index]];
    void changeProducts(groups, input.productUse ?? 'colors');
  }
  function removeProduct(index: number) {
    const groups = input.productGroups ?? [];
    void changeProducts(groups.filter((_, i) => index !== i), input.productUse ?? 'colors', groups[index].mediaIds);
  }

  function choose(skill: SkillInfo) {
    setPreviousSelection(skill.requirements?.referenceVideoRequired ? { selections: input.selections, targetDuration: input.targetDuration } : null);
    const selections = combine ? [...input.selections] : [];
    const exists = selections.some(x => x.versionId === skill.versionId);
    const next = exists ? selections.filter(x => x.versionId !== skill.versionId) : [...selections, { id: skill.id, versionId: skill.versionId, duration: skill.duration }];
    update({ selections: next, ...(followDuration ? { targetDuration: next.reduce((sum, item) => sum + item.duration, 0) || 17 } : {}) });
  }
  async function addImages(list: File[]) {
    setBusy(true); setError('');
    try {
      const result = await uploadSequentially(list, upload, saved => {
        setFiles(names => ({ ...names, [saved.id]: saved.name }));
        setInput(value => ({ ...value, media: [...value.media, { id: saved.id, role: value.media.length ? 'detail' : 'product' }] }));
      });
      if (result.failures.length) throw new Error(`已上传 ${result.succeeded} 张；未成功：${result.failures.join('；')}`);
    } finally { setBusy(false); }
  }
  async function generate() {
    if (submitting.current || reason) return;
    submitting.current = true; setBusy(true); setError('');
    let created = false;
    try {
      await draft.save();
      await api('/api/preferences', 'PUT', { platform: input.platform, market: input.market, category: input.category, model: input.model });
      const groupName = input.productGroups?.map(group => group.styleNumber).join(' / ');
      const task = await api<{ id: string }>('/api/tasks', 'POST', { ...input, name: (input.name || (groupName ? `${groupName} · 新创作` : input.styleNumber ? `${input.styleNumber} · 新创作` : input.productName || `${selected[0]?.name ?? '商品'} · 新创作`)).slice(0, 100) });
      created = true;
      window.dispatchEvent(new CustomEvent('workbench:tasks-changed'));
      try {
        await api(`/api/tasks/${task.id}/generate`, 'POST', { key: crypto.randomUUID(), costAccepted: true });
        notify('已加入任务栏');
      } catch (e) { notify((e as Error).message); }
      window.dispatchEvent(new CustomEvent('workbench:tasks-changed'));
      if (!mounted.current) return;
      setSettingsOpen(false);
      // The submitted input is already saved and locked throughout this request.
      registerDraftSaver(null);
      start({ platform: input.platform, market: input.market, category: input.category, model: input.model });
    } catch (e) { if (mounted.current) setError((e as Error).message); else notify((e as Error).message); }
    finally { if (!created && mounted.current) { submitting.current = false; setBusy(false); } }
  }

  return <div className="creation-workspace">
    <section className="panel creation-composer">
      <div className="creation-composer-actions" role="region" aria-label="创作操作">
        <span id="creation-next-hint" className="creation-next-hint" role="status">{nextHint}</span>
        <div className="inline"><ControlHint label="保存草稿"><button disabled={busy} aria-label="保存草稿" onClick={() => void draft.save().then(() => notify('草稿已保存')).catch(() => {})}>存草稿</button></ControlHint><button className="primary" disabled={nextDisabled} aria-describedby={nextHint ? 'creation-next-hint' : undefined} onClick={() => setSettingsOpen(true)}>下一步<Icon name="arrow"/></button></div>
      </div>
      <div className="creation-product">
        <div className="panel-header"><div className="creation-product-title"><h2>商品图</h2>{input.styleNumber ? <span className="tag blue creation-style-number" aria-label={`当前款号：${input.styleNumber}`}>{input.styleNumber}</span> : null}</div><div className="creation-product-tools"><span className="save-state">{draft.status}</span><button aria-label="选择款号" disabled={busy} onClick={() => setProductPickerOpen(true)}><Icon name="library"/>选款号</button></div></div>
        <ProductGroups input={input} disabled={busy} onUse={use => void changeProducts(input.productGroups ?? [], use)} onMove={moveProduct} onRemove={removeProduct}/>
        <div className={input.media.length ? 'product-grid' : 'product-upload'}>
          {input.media.map((file, index) => <div className="product-tile" key={file.id}>
            {input.productGroups?.length ? <span className="creation-product-group-label">{groupLabels.get(file.id)?.join(' / ') ?? '补充图'}</span> : null}
            <img src={mediaUrl(file.id)} alt={files[file.id] ?? `商品参考图 ${index + 1}`}/>
            <select aria-label={`图片 ${index + 1} 用途`} value={file.role} disabled={busy} onChange={e => update({ media: input.media.map(item => item.id === file.id ? { ...item, role: e.target.value as 'product' | 'detail' | 'comparison' } : item) })}>
              <option value="product">主商品图</option><option value="detail">同款细节</option><option value="comparison">对比商品</option>
            </select>
            <button className="text-button" aria-label={`移除图片 ${index + 1}`} disabled={busy} onClick={() => setInput(value => ({ ...value, ...removeProductImage(value, file.id), ...(!value.productGroups?.length && value.media.length === 1 ? { productSetId: undefined, styleNumber: undefined } : {}) }))}>移除</button>
          </div>)}
          <FileDropzone key="product-upload" label={input.media.length ? '补充商品图' : '上传商品图'} kind="image" multiple maxFiles={MAX_TASK_IMAGES - input.media.length} compact={Boolean(input.media.length)} disabled={busy || input.media.length >= MAX_TASK_IMAGES} hint={`PNG / JPG / WEBP · 每张 ≤ 20 MB · 最多 ${MAX_TASK_IMAGES} 张`} onFiles={addImages}/>
        </div>
      </div>

      <section className="creation-skill-picker" aria-label="Skill 选择">
        <div className="panel-header creation-picker-header">
          <div className="inline creation-picker-title"><h2>脚本</h2><small>{skills?.length ?? 0}</small></div>
        </div>
        {libraryError ? <Message error>{libraryError}<button onClick={() => void refreshSkills()}>重试</button></Message> : null}
        <div className="creation-skill-viewport" tabIndex={0} role="region" aria-label="全部 Skill" aria-busy={loading}>
          {loading ? <div className="creation-skill-empty" role="status">加载中…</div> : visibleSkills.length ? <div className="skill-grid compact-skill-grid">
            {visibleSkills.map(skill => <SkillSelectionCard key={skill.versionId} skill={skill} selected={input.selections.some(item => item.versionId === skill.versionId)} disabled={busy} onSelect={() => choose(skill)}/>)}
          </div> : <Empty title="暂无 Skill"><button onClick={() => navigate('library')}>导入脚本</button></Empty>}
        </div>
        <div className="inline between creation-selection-row">
          <label className="check-label creation-combine-check"><input type="checkbox" aria-label="需要组合多个片段" checked={combine} disabled={busy} onChange={e => setCombine(e.target.checked)}/><span className="creation-check-box" aria-hidden="true"><Icon name="check"/></span>多片段</label>
          <span>{selected.length} 套 · {duration || Math.round(selected.reduce((sum, item) => sum + item.duration, 0) * 100) / 100} 秒</span>
        </div>
      </section>

      {references.required.map(skill => <div className="creation-reference-row" key={skill.versionId}><span>{skill.name}</span><button className="text-button" onClick={() => references.setReview(skill)}>查看要求与下载对标</button></div>)}
      {selectionError && selected.length ? <Message error>{selectionError}</Message> : null}
      {error || draft.error ? <Message error>{error || draft.error}</Message> : null}
    </section>

    {references.notice ? <ReferenceVideoNotice skill={references.notice} onConfirm={() => { references.accept(references.notice!); setPreviousSelection(null); }} onCancel={() => { const version = references.notice!.versionId; references.setReview(null); update(previousSelection ?? { selections: input.selections.filter(item => item.versionId !== version) }); setPreviousSelection(null); }}/> : null}
    {productPickerOpen ? <ProductSetPicker initialIds={input.productGroups?.map(group => group.productSetId) ?? (input.productSetId ? [input.productSetId] : [])} onChoose={loadProductSets} onClose={() => setProductPickerOpen(false)}/> : null}
    {settingsOpen ? <Modal title="生成设置" onClose={() => { if (!busy) setSettingsOpen(false); }}>
      <form className="creation-settings-form" onSubmit={event => { event.preventDefault(); void generate(); }}>
        <SelectedSkills items={selected} combine={combine} disabled={busy} update={selections => update({ selections })}/>
        <fieldset disabled={busy}><CreationSettings value={input} update={update} onDuration={() => setFollowDuration(false)}/></fieldset>
        {reason ? <Message error>{reason}{missingConfig && user.role === 'admin' ? <button type="button" className="text-button" onClick={() => { setSettingsOpen(false); navigate('settings'); }}>配置接口</button> : null}</Message> : null}
        {error ? <Message error>{error}</Message> : null}
        <div className="modal-footer"><button type="button" disabled={busy} onClick={() => setSettingsOpen(false)}>返回</button><button type="submit" className="primary" aria-label={busy ? '提交中…' : '生成提示词'} aria-busy={busy || undefined} disabled={Boolean(reason) || busy}>{busy ? '提交中' : '生成'}<Icon name="arrow"/></button></div>
      </form>
    </Modal> : null}
  </div>;
}
