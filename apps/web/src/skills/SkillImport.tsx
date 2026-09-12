import { useState } from 'react';
import { api, upload } from '../api';
import { useWorkspace } from '../workspace';
import { FileDropzone } from '../uploads/FileDropzone';
import { Modal, Message, kindLabel } from '../ui';
import type { SkillInfo } from '../../../../packages/contracts';

interface Preview { text: string; suggestedName: string; suggestedKind: SkillInfo['kind']; suggestedDuration: number | null; missing: string[]; files: { path: string; mime: string; size: number }[]; }
export function SkillImport({ existing, onClose, onDone }: { existing?: SkillInfo; onClose: () => void; onDone: () => void }) {
  const { user } = useWorkspace();
  const [preview, setPreview] = useState<Preview | null>(null); const [mediaId, setMediaId] = useState(''); const [name, setName] = useState(existing?.name ?? ''); const [text, setText] = useState(existing?.text ?? '');
  const [kind, setKind] = useState<SkillInfo['kind']>(existing?.kind ?? 'full'); const [duration, setDuration] = useState(existing?.duration ?? 17); const [tags, setTags] = useState(existing?.tags.join('，') ?? ''); const [source, setSource] = useState(existing?.source ?? '');
  const [visibility, setVisibility] = useState(existing?.visibility ?? 'private'); const [sharingConfirmed, setSharingConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function inspect(file?: File) {
    if (!file) return; setBusy(true); setError('');
    try { const uploaded = await upload(file); const result = await api<Preview>('/api/skills/inspect', 'POST', { mediaId: uploaded.id }); setPreview(result); setMediaId(uploaded.id); setText(result.text); if (!existing) { setName(result.suggestedName); setKind(result.suggestedKind); setDuration(result.suggestedDuration ?? 17); } }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const info = { name, kind, duration, tags: tags.split(/[,，]/).map(x => x.trim()).filter(Boolean), source, visibility, sharingConfirmed, ...(mediaId ? { mediaId } : { text }) };
      await api(existing ? `/api/skills/${existing.id}/versions` : '/api/skills', 'POST', info);
      if (existing) await api(`/api/skills/${existing.id}`, 'PATCH', { ...info, sharingConfirmed: sharingConfirmed || existing.visibility === 'public' });
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={existing ? '更新脚本，保留旧版本' : '导入已验证的脚本'} onClose={onClose}><div className="form-stack"><FileDropzone label="选择 ZIP Skill 包或 Markdown 文件" inputLabel="导入脚本文件" kind="skill" disabled={busy} onFiles={files => inspect(files[0])}/><small>保留原包和有效引用，导入不会执行脚本或访问包内网站。</small>{preview || existing ? <><div className="field-grid"><label>脚本名称<input value={name} onChange={e => setName(e.target.value)}/></label><label>标签<input value={tags} onChange={e => setTags(e.target.value)} placeholder="阳光，停车场，服装"/></label><label>脚本类型<select value={kind} onChange={e => setKind(e.target.value as SkillInfo['kind'])}>{['full', 'opening', 'detail', 'outfit', 'comparison'].map(k => <option key={k} value={k}>{kindLabel[k]}</option>)}</select></label><label>默认时长（秒）<input type="number" min="0.5" max="300" step="0.5" value={duration} onChange={e => setDuration(Number(e.target.value))}/></label></div><label>来源或版本说明<input value={source} onChange={e => setSource(e.target.value)} placeholder="例如：本人已验证，调整了阳光与风动"/></label>{user.role === 'admin' ? <><label>保存位置<select value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'public')}><option value="private">我的私人脚本</option><option value="public">公共脚本库</option></select></label>{visibility === 'public' && existing?.visibility !== 'public' ? <label className="check-label"><input type="checkbox" checked={sharingConfirmed} onChange={e => setSharingConfirmed(e.target.checked)}/>我确认有权向工作台成员共享脚本及随包素材</label> : null}</> : null}{preview?.missing.length ? <Message>缺少引用：{preview.missing.join('、')}。可以保存，但生成前请补齐关键脚本资料。</Message> : null}<details className="advanced"><summary>检查脚本与包内文件</summary><div>{mediaId ? <pre className="source-text">{text}</pre> : <label>脚本正文<textarea className="source-editor" value={text} onChange={e => setText(e.target.value)}/></label>}{preview?.files.map(f => <small key={f.path}>{f.path} · {Math.ceil(f.size / 1024)} KB</small>)}</div></details></> : null}{error ? <Message error>{error}</Message> : null}</div><div className="modal-footer"><button onClick={onClose}>取消</button><button className="primary" disabled={busy || !name || (!preview && !existing) || (visibility === 'public' && existing?.visibility !== 'public' && !sharingConfirmed)} onClick={() => void save()}>{existing ? '保存为新版本' : '确认导入'}</button></div></Modal>;
}
