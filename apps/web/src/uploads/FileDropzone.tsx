import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Icon, Message } from '../ui';
import { droppedFiles, isFileDrag, uploadAccept, uploadHint, validateUploadFiles, type UploadKind } from './file-upload';

interface Props {
  label: string;
  inputLabel?: string;
  kind: UploadKind;
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  compact?: boolean;
  hint?: string;
  onFiles: (files: File[]) => Promise<void> | void;
}

export function FileDropzone({ label, inputLabel = label, kind, multiple = false, maxFiles = 1, disabled = false, compact = false, hint, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0); const pending = useRef(false);
  const [dragging, setDragging] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [names, setNames] = useState<string[]>([]);
  const descriptionId = useId(); const locked = disabled || busy;
  useEffect(() => { if (locked) { depth.current = 0; setDragging(false); } }, [locked]);
  const clearDrag = () => { depth.current = 0; setDragging(false); };
  async function choose(files: File[]) {
    if (disabled || pending.current) return;
    setError('');
    try {
      const valid = validateUploadFiles(files, kind, multiple ? maxFiles : 1);
      if (!valid.length) return;
      pending.current = true; setBusy(true);
      await onFiles(valid);
      setNames(valid.map(file => file.name));
    } catch (e) { setError(e instanceof Error ? e.message : '上传未成功，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = locked ? 'none' : 'copy';
    if (!locked) setDragging(true);
  }
  return <div className={`file-dropzone ${compact ? 'compact' : ''} ${dragging ? 'drag-active' : ''}`} role="group" aria-label="文件拖放区" aria-busy={busy}
    onDragEnter={event => { if (!isFileDrag(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); if (!locked) { depth.current++; setDragging(true); } }}
    onDragOver={dragOver}
    onDragLeave={event => { if (!isFileDrag(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={event => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault(); event.stopPropagation(); clearDrag();
      if (locked || pending.current) return;
      try { void choose(droppedFiles(event.dataTransfer)); }
      catch (e) { setError((e as Error).message); }
    }}>
    <button type="button" className="uploader" disabled={locked} aria-describedby={descriptionId} onClick={() => input.current?.click()}>
      <span className="upload-icon"><Icon name="upload"/></span>
      <strong>{busy ? '正在处理，请稍候…' : dragging ? '松开即可添加文件' : label}</strong>
      <span className="drop-instruction">{multiple ? '拖入一张或多张文件，也可点击选择' : '拖入一个文件，也可点击选择'}</span>
      <small id={descriptionId}>{hint || uploadHint[kind]}</small>
    </button>
    <input ref={input} type="file" hidden aria-label={inputLabel} multiple={multiple} accept={uploadAccept[kind]} disabled={locked}
      onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void choose(files); }}/>
    {names.length ? <small className="upload-filenames" role="status">已选择：{names.join('、')}</small> : null}
    {error ? <Message error>{error}</Message> : null}
  </div>;
}

/** One guard for the entire app: dropped files must never replace the page. */
export function useFileNavigationGuard() {
  useEffect(() => {
    const prevent = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', prevent); window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);
}
