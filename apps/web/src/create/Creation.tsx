import { useState, useEffect } from 'react';
import type { CreationInput, SkillInfo } from '../../../../packages/contracts';
import { api, upload, mediaUrl } from '../api';
import { useLoad, useWorkspace, type CreationStart } from '../workspace';
import { Icon, Message, Empty, Modal, kindLabel } from '../ui';
import { CreationSettings } from './CreationSettings';
import { useDraft } from './useDraft';
import { FileDropzone } from '../uploads/FileDropzone';
import { uploadSequentially } from '../uploads/file-upload';
import { planSelection } from '../../../../packages/domain/planning';
import { SkillSelectionCard } from './SkillSelectionCard';
import { ReferenceVideoNotice } from '../skills/ReferenceVideoNotice';
import { useReferenceVideoRequirement } from './useReferenceVideoRequirement';

export function Creation({ initial: supplied }: { initial: CreationStart }) {
  const { _draftId, ...initial } = supplied;
  const { config, preferences, navigate, notify, registerDraftSaver, user } = useWorkspace();
  const [input, setInput] = useState<CreationInput>(() => ({ name: '', media: [], platform: (preferences.platform as CreationInput['platform']) || 'douyin', market: (preferences.market as CreationInput['market']) || 'CN', category: preferences.category || '服装', targetDuration: 17, model: (preferences.model as CreationInput['model']) || 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'inherit', selections: [], productName: '', facts: '', audience: '', personNotes: '', sceneNotes: '', extra: '', ...initial }));
  const [files, setFiles] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false); const [combine, setCombine] = useState(false); const [followDuration, setFollowDuration] = useState(!initial.targetDuration);
  const { data: skills, error: libraryError, refresh: refreshSkills } = useLoad<SkillInfo[]>('/api/skills');
  const references = useReferenceVideoRequirement(input.selections, skills);
  const [previousSelection, setPreviousSelection] = useState<Pick<CreationInput, 'selections' | 'targetDuration'> | null>(null);
  const draft = useDraft(input as unknown as Record<string, unknown>, Boolean(input.media.length || input.selections.length || input.extra || input.name), _draftId);
  useEffect(() => { registerDraftSaver(draft.save); return () => registerDraftSaver(null); }, [draft.save, registerDraftSaver]);
  useEffect(() => { const refresh = () => { if (location.hash === '#create') void refreshSkills(); }; window.addEventListener('hashchange', refresh); return () => window.removeEventListener('hashchange', refresh); }, [refreshSkills]);
  const update = (patch: Partial<CreationInput>) => setInput(value => ({ ...value, ...patch }));
  const selected = input.selections.map(item => { const skill = skills?.find(x => x.id === item.id); return { ...item, name: skill?.name ?? '已保存脚本版本', kind: skill?.kind ?? 'opening' as const }; });
  let selectionError = ''; let duration = 0;
  try { duration = planSelection(selected, input.targetDuration).selectedDuration; } catch (e) { selectionError = (e as Error).message; }
  const quota = config.quotas.find(x => x.kind === 'text');
  const available = quota ? Math.max(0, quota.allowance - quota.used - quota.reserved) : 0;
  const missingConfig = !config.text.enabled || !config.text.configured || !config.text.vision;
  const reason = references.reason || (!input.media.length ? '先上传你的商品图' : !input.media.some(x => x.role === 'product') ? '请将至少一张图片指定为主商品图' : !input.selections.length ? '再选择一个脚本' : selectionError || (missingConfig ? '尚未配置文字／视觉接口，脚本和草稿仍可保存' : available < 1 ? user.role === 'admin' ? '文字额度不足，请到管理设置调整' : '文字额度不足，请联系管理员' : ''));
  function choose(skill: SkillInfo) {
    setPreviousSelection(skill.requirements?.referenceVideoRequired ? { selections: input.selections, targetDuration: input.targetDuration } : null);
    let selections = combine ? [...input.selections] : [];
    const exists = selections.find(x => x.versionId === skill.versionId);
    selections = exists ? selections.filter(x => x.versionId !== skill.versionId) : [...selections, { id: skill.id, versionId: skill.versionId, duration: skill.duration }];
    update({ selections, ...(followDuration ? { targetDuration: selections.reduce((sum, s) => sum + s.duration, 0) || 17 } : {}) });
  }
  async function addImages(list: File[]) {
    setBusy(true); setError('');
    try {
      const result = await uploadSequentially(list, upload, saved => {
        setFiles(names => ({ ...names, [saved.id]: saved.name }));
        setInput(value => ({ ...value, media: [...value.media, { id: saved.id, role: value.media.length ? 'detail' : 'product' }] }));
      });
      if (result.failures.length) throw new Error(`已成功上传 ${result.succeeded} 张，成功图片已保留。请只重试未成功的文件：${result.failures.join('；')}`);
    } finally { setBusy(false); }
  }
  async function generate() {
    setConfirm(false); setBusy(true); setError('');
    try {
      await draft.save();
      await api('/api/preferences', 'PUT', { platform: input.platform, market: input.market, category: input.category, model: input.model });
      const task = await api<{ id: string }>('/api/tasks', 'POST', { ...input, name: input.name || input.productName || `${selected[0]?.name ?? '商品'} · 新创作` });
      try { await api(`/api/tasks/${task.id}/generate`, 'POST', { key: crypto.randomUUID(), costAccepted: true }); } catch (e) { notify((e as Error).message); }
      navigate(`task/${task.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><div className="steps"><span className={`step ${input.media.length ? 'done' : 'active'}`}><b>{input.media.length ? '✓' : '1'}</b>上传商品</span><Icon name="arrow"/><span className={`step ${input.selections.length ? 'done' : input.media.length ? 'active' : ''}`}><b>{input.selections.length ? '✓' : '2'}</b>选择脚本</span><Icon name="arrow"/><span className="step"><b>3</b>拿到提示词</span></div><div className="columns"><div className="stack"><section className="panel blue"><div className="panel-header"><h2>这次带哪件商品？</h2><span className="save-state">{draft.status}</span></div>
    <div className={input.media.length ? 'product-grid' : 'product-upload'}>{input.media.map((file, i) => <div className="product-tile" key={file.id}><img src={mediaUrl(file.id)} alt={files[file.id] ?? `商品参考图 ${i + 1}`}/><select aria-label={`图片 ${i + 1} 用途`} value={file.role} onChange={e => update({ media: input.media.map(x => x.id === file.id ? { ...x, role: e.target.value as 'product' | 'detail' | 'comparison' } : x) })}><option value="product">主商品图</option><option value="detail">同款细节</option><option value="comparison">对比商品</option></select><button className="text-button" onClick={() => update({ media: input.media.filter(x => x.id !== file.id) })}>移除</button></div>)}<FileDropzone key="product-upload" label={input.media.length ? '补充商品图' : '上传商品图'} kind="image" multiple maxFiles={12 - input.media.length} compact={Boolean(input.media.length)} disabled={busy} hint={input.media.length ? `还可添加 ${12 - input.media.length} 张 · 每张 ≤ 20 MB` : '主图、同款细节图都可以 · 最多 12 张 · PNG / JPG / WEBP · 每张 ≤ 20 MB'} onFiles={addImages}/></div>
    <div className="setting-summary"><span>{input.platform === 'douyin' ? '抖音' : 'TikTok'}</span><span>{{ CN: '中国', US: '美国', VN: '越南' }[input.market]}</span><span>{input.model.replace('seedance-', 'Seedance ')}</span><span>{input.generatePerson || input.generateScene ? '先文字，参考图另行确认' : '仅文字，不生成人物／场景图'}</span></div></section>
    {references.required.map(skill => <section className="panel yellow" key={skill.versionId}><h3>此 Skill 需同步上传对标视频</h3><p>{skill.name}：到外部平台生成时，请将商品图和原始完整对标视频连入同一节点。</p><button onClick={() => references.setReview(skill)}>查看要求与下载对标</button></section>)}
    {references.notice ? <ReferenceVideoNotice skill={references.notice} onConfirm={() => { references.accept(references.notice!); setPreviousSelection(null); }} onCancel={() => { const version = references.notice!.versionId; references.setReview(null); update(previousSelection ?? { selections: input.selections.filter(item => item.versionId !== version) }); setPreviousSelection(null); }}/> : null}
    <CreationSettings value={input} update={update} onDuration={() => setFollowDuration(false)}/>
    <section><div className="panel-header"><h2>选一个验证过的拍法</h2><button className="text-button" onClick={() => navigate('library')}>查看脚本库 ↗</button></div>{libraryError ? <Message error>{libraryError}<button onClick={() => void refreshSkills()}>重试</button></Message> : null}{skills?.length ? <><div className="skill-grid">{skills.slice(0, 9).map(skill => <SkillSelectionCard key={skill.versionId} skill={skill} selected={input.selections.some(x => x.versionId === skill.versionId)} onSelect={() => choose(skill)}/>)}</div><div className="inline between section-space"><label className="check-label"><input type="checkbox" checked={combine} onChange={e => setCombine(e.target.checked)}/>需要组合多个片段</label><small>默认使用一套完整脚本即可</small></div></> : <Empty title="先放进你的第一个脚本"><p>导入已经验证过的 ZIP Skill 包或 Markdown 文件。</p><button onClick={() => navigate('library')}>去导入脚本</button></Empty>}</section>{error || draft.error ? <Message error>{error || draft.error}</Message> : null}
  </div><aside className="summary stack"><section className="panel yellow"><h2>本次创作</h2><p className="muted">只生成你选中的内容</p><div className="scope"><div><small>所选内容</small><strong>{duration || selected.reduce((sum, s) => sum + s.duration, 0)}<small className="scope-unit">秒</small></strong></div><span className="tag">{selected.length} 套脚本</span></div>{selected.map((item, index) => <div className="summary-item" key={item.versionId}><div><strong>{item.name}</strong><small>{kindLabel[item.kind]}</small>{combine ? <div className="inline"><button className="text-button" disabled={!index} onClick={() => { const next = [...input.selections]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update({ selections: next }); }}>上移</button><button className="text-button" onClick={() => update({ selections: input.selections.filter(s => s.versionId !== item.versionId) })}>移除</button></div> : null}</div>{combine ? <input aria-label={`${item.name}时长`} type="number" min="0.5" step="0.5" value={item.duration} className="summary-duration" onChange={e => update({ selections: input.selections.map(s => s.versionId === item.versionId ? { ...s, duration: Number(e.target.value) } : s) })}/> : <span>{item.duration}s</span>}</div>)}{input.targetDuration !== duration && duration > 0 ? <small className="section-space">目标全片 {input.targetDuration} 秒，本次只做所选 {duration} 秒，不自动补齐。</small> : null}<button className="primary" disabled={Boolean(reason) || busy} onClick={() => setConfirm(true)}>生成提示词<Icon name="arrow"/></button><small className="section-space">{reason || `可用文字额度 ${available} 次。下一步会先确认本次请求。`}</small>{missingConfig && user.role === 'admin' ? <button className="text-button" onClick={() => navigate('settings')}>配置接口与额度 →</button> : null}</section><section className="panel"><h3>你会得到</h3><p>可编辑的中文镜头提示词<br/>按需附配音文案与字幕<br/>分批提示词与素材清单</p><small>在外部视频平台生成视频。这里不会直接生成或拼接视频。</small></section><button onClick={() => void draft.save().then(() => notify('草稿已保存')).catch(() => {})} disabled={busy}>保存草稿</button></aside></div>
  {confirm ? <Modal title="确认生成这次提示词" onClose={() => setConfirm(false)}><p>将使用本账号 <strong>1 次文字额度</strong>，把当前商品图和所选脚本发送至管理员配置的服务。</p><Message>本次只生成文字，不生成人物图、场景图或视频。服务商实际费用以其账单为准。</Message><p>关闭网页后任务仍在后台处理。接口响应不明时会暂停重试，避免重复请求。</p><div className="modal-footer"><button onClick={() => setConfirm(false)}>再看看</button><button className="primary" onClick={() => void generate()}>确认，开始生成</button></div></Modal> : null}</>;
}
