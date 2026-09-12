import { useEffect, useState } from 'react';
import type { CreationInput, SkillInfo } from '../../../../packages/contracts';
import { api } from '../api';

// Resolve the selected version, not merely the newest version in the library.
export function useReferenceVideoRequirement(selections: CreationInput['selections'], skills: SkillInfo[] | null) {
  const [older, setOlder] = useState<SkillInfo[]>([]);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [review, setReview] = useState<SkillInfo | null>(null);
  const versions = selections.map(item => item.versionId).join(',');
  const missing = selections.filter(item => ![...(skills ?? []), ...older].some(skill => skill.versionId === item.versionId));
  const unresolved = missing.map(item => `${item.id}/${item.versionId}`).join(',');
  useEffect(() => { setAcknowledged(current => current.filter(id => versions.split(',').includes(id))); }, [versions]);
  useEffect(() => {
    if (!skills || !unresolved) { setError(''); return; }
    let active = true; setError('');
    void Promise.all(unresolved.split(',').map(pair => { const [id, version] = pair.split('/'); return api<SkillInfo>(`/api/skills/${id}?version=${version}`); }))
      .then(found => { if (active) setOlder(current => [...current.filter(item => !found.some(x => x.versionId === item.versionId)), ...found]); })
      .catch(e => { if (active) setError(`无法核对此版本的素材要求：${(e as Error).message}`); });
    return () => { active = false; };
  }, [skills, unresolved]);
  const required = selections.flatMap(item => {
    const skill = [...(skills ?? []), ...older].find(x => x.versionId === item.versionId);
    return skill?.requirements?.referenceVideoRequired ? [skill] : [];
  });
  const pending = required.find(skill => !acknowledged.includes(skill.versionId));
  return { required, notice: review ?? pending, review, setReview,
    accept: (skill: SkillInfo) => { setAcknowledged(current => [...new Set([...current, skill.versionId])]); setReview(null); },
    reason: error || (selections.length && (!skills || missing.length) ? '正在核对脚本版本的素材要求…' : pending ? '请先确认同步上传对标视频的要求' : ''),
  };
}
