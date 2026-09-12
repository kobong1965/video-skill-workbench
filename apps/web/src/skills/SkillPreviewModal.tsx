import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api';
import { Message, Modal } from '../ui';
import type { SkillPreview } from './skill-preview';

export function SkillPreviewModal({ name, version, preview, onClose }: {
  name: string; version: number; preview: SkillPreview; onClose: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const file = preview.video ?? preview.image!;
  useEffect(() => {
    const video = player.current;
    // A click opens this player; autoplay restrictions still leave native controls available.
    void video?.play().catch(() => {});
    return () => video?.pause();
  }, []);

  return <Modal title={`${name} · ${preview.video ? '效果视频' : '参考图片'}`} onClose={onClose}>
    <div className="skill-preview-body">
      <p className="muted">当前脚本 v{version} 的预览素材 · 查看效果不会改变已选脚本</p>
      {preview.video
        ? <video ref={player} controls autoPlay playsInline preload="metadata" src={mediaUrl(file.mediaId)} aria-label={`${name}效果视频`} onError={() => setFailed(true)}/>
        : <img src={mediaUrl(file.mediaId)} alt={`${name}参考图片`} onError={() => setFailed(true)}/>}
      {failed ? <Message error>素材暂时无法{preview.video ? '播放' : '显示'}。可下载原文件查看，或到脚本库重新补传预览。</Message> : null}
      <div className="skill-preview-footer"><small>{preview.video ? '支持播放／暂停、拖动进度、音量和全屏。若未自动播放，点击播放器的播放按钮。' : '这个版本尚未包含效果视频，当前展示包内参考图片。'}</small><a href={`${mediaUrl(file.mediaId)}?download=1`}>下载原素材 ↗</a></div>
    </div>
  </Modal>;
}
