import { useEffect, useRef, useState } from 'react';
import type { SkillInfo } from '../../../../packages/contracts';
import { mediaUrl } from '../api';
import { Icon, kindLabel } from '../ui';
import { getSkillPreview } from '../skills/skill-preview';
import { SkillPreviewModal } from '../skills/SkillPreviewModal';

export function SkillSelectionCard({ skill, selected, onSelect }: {
  skill: SkillInfo; selected: boolean; onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const preview = getSkillPreview(skill.files);
  useEffect(() => {
    if (wasOpen.current && !open) previewButton.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  return <article className={`skill-card skill-selection-card ${selected ? 'selected' : ''}`} aria-label={skill.name}>
    <button type="button" className="skill-select-button" aria-label={`选择脚本：${skill.name}`} aria-pressed={selected} onClick={onSelect}>
      <span className="card-meta"><span className="tag">{kindLabel[skill.kind]}</span><span className="duration">{skill.duration}s</span></span>
      <span className="skill-card-copy"><span className="skill-card-title">{skill.name}</span><span className="skill-card-tags">{skill.tags.join(' · ') || '已保存的脚本模板'}</span></span>
      <span className="card-bottom"><small>v{skill.version} · {skill.visibility === 'private' ? '私人' : '公共'}</small><span className="select-mark" aria-hidden="true">{selected ? '✓' : '＋'}</span></span>
    </button>
    {preview ? <button ref={previewButton} type="button" className="skill-preview-thumb" aria-label={`${preview.video ? '播放效果视频' : '查看参考图片'}：${skill.name}`} onClick={() => setOpen(true)}>
      {preview.image && !imageFailed
        ? <img src={mediaUrl(preview.image.mediaId)} alt="" loading="lazy" onError={() => setImageFailed(true)}/>
        : preview.video && !videoFailed
          ? <video src={mediaUrl(preview.video.mediaId)} muted playsInline preload="metadata" aria-hidden="true" onError={() => setVideoFailed(true)}/>
          : <Icon name="image"/>}
      <span className="skill-preview-action" aria-hidden="true">{preview.video ? <span className="preview-play">▶</span> : <Icon name="image"/>}</span>
      <span className="skill-preview-caption">{preview.video ? '播放效果' : '查看图片'}</span>
    </button> : <div className="skill-preview-thumb skill-preview-empty" role="img" aria-label={`${skill.name}暂无预览素材`} title="可到脚本库补传效果视频或封面"><Icon name="image"/><span>暂无预览</span></div>}
    {open && preview ? <SkillPreviewModal name={skill.name} version={skill.version} preview={preview} onClose={() => setOpen(false)}/> : null}
  </article>;
}
