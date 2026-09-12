import type { SkillInfo } from '../../../../packages/contracts';
import { mediaUrl } from '../api';
import { Modal, Message } from '../ui';
import { useEffect, useRef } from 'react';

export function ReferenceVideoNotice({ skill, onConfirm, onCancel }: { skill: SkillInfo; onConfirm: () => void; onCancel: () => void }) {
  const returnFocus = useRef(document.activeElement);
  useEffect(() => () => { queueMicrotask(() => { const target = returnFocus.current; if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true }); }); }, []);
  const reference = skill.requirements?.benchmarkVideo;
  return <Modal title="使用此 Skill 需同步上传对标视频" onClose={onCancel}>
    <p><strong>{skill.name}</strong> · v{skill.version}</p>
    <Message>生成视频时，必须同时上传<strong>商品图 ＋ 原始完整对标视频</strong>，并把两者连接到外部平台的同一个视频生成节点。</Message>
    <p>仅上传商品图、工作流截图、单张首帧，或只在提示词中写“参考对标”，都不能替代完整对标视频。包内成片用于对照验收，不是原对标。</p>
    {reference?.mediaId ? <div className="reference-download"><strong>本版原始对标素材</strong><p>{reference.path.split('/').pop()}</p><a className="button" href={`${mediaUrl(reference.mediaId)}?download=1`} download>下载原始对标视频</a></div> : <Message error>包内未找到可下载的对标视频，请准备原始完整视频后再到外部平台生成。</Message>}
    <p className="muted">工作台这里只生成提示词。点击下方按钮仅表示你已了解要求，不代表素材已上传到 LibTV 或已完成连线。</p>
    <div className="modal-footer"><button onClick={onCancel}>取消使用</button><button className="primary" onClick={onConfirm}>我已了解，继续使用</button></div>
  </Modal>;
}
