import { useEffect, useRef, useState } from 'react';
import type { TaskSummary } from '../../../../packages/contracts';
import { mediaUrl } from '../api';
import { Icon } from '../ui';
import './task-media.css';

function Thumbnail({ imageId, videoId, label, empty }: { imageId?: string | null; videoId?: string | null; label: string; empty: string }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const showImage = imageId && !imageFailed;
  const showVideo = !showImage && videoId && !videoFailed;
  useEffect(() => {
    if (!showVideo || visible || !frame.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [showVideo, visible]);
  return <span className="task-media-frame" ref={frame}>
    {showImage ? <img src={mediaUrl(imageId)} alt={label} loading="lazy" onError={() => setImageFailed(true)}/>
      : showVideo ? <video src={visible ? mediaUrl(videoId) : undefined} muted playsInline preload={visible ? 'metadata' : 'none'} aria-label={label.replace('脚本封面', '脚本视频缩略图')} onError={() => setVideoFailed(true)}/>
        : <span className="task-media-empty" role="img" aria-label={`${label}，${empty}`}><Icon name="image"/><span>{empty}</span></span>}
  </span>;
}

export function TaskMedia({ task, onOpen, history = false }: { task: TaskSummary; onOpen: () => void; history?: boolean }) {
  const previews = task.skillPreviews ?? [];
  return <div className={`task-media-pair${history ? ' task-media-history' : ''}`}>
    <button type="button" className="task-media-item task-product-thumb" aria-label={`查看任务：${task.name}`} title={task.name} onClick={onOpen}>
      <Thumbnail key={task.thumbnailMediaId ?? 'empty'} imageId={task.thumbnailMediaId} label={`商品主图：${task.name}`} empty="无主图"/>
      <span className="task-media-caption">商品</span>
    </button>
    <div className="task-script-strip" role="group" aria-label={`${task.name}所用脚本`}>
      {previews.length ? previews.map((preview, index) => <button key={`${preview.versionId}:${index}`} type="button" className="task-media-item task-script-thumb" aria-label={`查看任务脚本：${task.name} · ${preview.name}`} title={`所用脚本：${preview.name}`} onClick={onOpen}>
        <Thumbnail key={`${preview.imageMediaId}:${preview.videoMediaId}`} imageId={preview.imageMediaId} videoId={preview.videoMediaId} label={`脚本封面：${preview.name}`} empty="无封面"/>
        {previews.length > 1 ? <span className="task-script-index" aria-hidden="true">{index + 1}/{previews.length}</span> : null}
        <span className="task-media-caption">脚本</span>
      </button>) : <div className="task-media-item" title="未保存脚本预览素材">
        <Thumbnail label="脚本封面" empty="无封面"/><span className="task-media-caption">脚本</span>
      </div>}
    </div>
  </div>;
}
