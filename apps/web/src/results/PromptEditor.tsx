import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResultRevision, TaskInfo } from '../../../../packages/contracts';
import { renderPrompt } from '../../../../packages/domain/planning';
import { api, copyText } from '../api';
import { AsyncButton, ControlHint, Icon } from '../ui';
import { useWorkspace } from '../workspace';
import { formatPromptDocument, parsePromptDocument } from './prompt-document';
import './result-editor.css';

export function PromptEditor({ task, result, refresh, onDirtyChange }: {
  task: TaskInfo; result: ResultRevision; refresh: () => Promise<void>;
  onDirtyChange: (resultId: string | null) => void;
}) {
  const { notify, registerNavigationGuard } = useWorkspace();
  const original = useMemo(() => formatPromptDocument(result.output), [result.output]);
  const [document, setDocument] = useState(original);
  const dirty = document !== original;
  const working = task.jobs.some(job => ['queued', 'running'].includes(job.status));
  const guardOwner = useRef(Symbol('prompt-editor'));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const documentRef = useRef(document); documentRef.current = document;

  useEffect(() => {
    const owner = guardOwner.current;
    registerNavigationGuard(owner, () => dirtyRef.current);
    return () => { dirtyRef.current = false; registerNavigationGuard(owner, null); onDirtyChange(null); };
  }, [registerNavigationGuard, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function change(value: string) {
    setDocument(value);
    onDirtyChange(value !== original ? result.id : null);
  }

  return <section className="panel prompt-editor-panel" aria-label="提示词编辑">
    <div className="panel-header prompt-editor-header">
      <div className="prompt-editor-title"><h2><span aria-hidden="true">提示词</span><span className="sr-only">完整提示词</span></h2><span className={`tag ${dirty ? 'yellow' : 'gray'}`}>{dirty ? '修改尚未保存' : `已保存 R${result.number}`}</span></div>
      <div className="prompt-editor-actions">
        <ControlHint label="复制整段提示词"><AsyncButton aria-label="复制整段提示词" title="复制整段提示词" action={async () => { await copyText(renderPrompt(parsePromptDocument(document, result.output))); notify('完整提示词已复制'); }}><Icon name="copy"/><span>复制</span></AsyncButton></ControlHint>
        {dirty ? <ControlHint label="撤销未保存修改"><button aria-label="撤销未保存修改" title="撤销未保存修改" onClick={() => change(original)}><Icon name="undo"/><span>撤销</span></button></ControlHint> : null}
        <ControlHint label="保存修改为新版本"><AsyncButton className="primary" aria-label="保存修改为新版本" title="保存修改为新版本" disabled={!dirty || working} action={async () => {
          const output = parsePromptDocument(document, result.output);
          await api(`/api/tasks/${task.id}/results`, 'POST', { output });
          await refresh();
          if (dirtyRef.current && documentRef.current === document) onDirtyChange(null);
          notify('修改已保存为新版本');
        }}><Icon name="save"/><span>保存</span></AsyncButton></ControlHint>
      </div>
    </div>
    <textarea className="prompt-document" aria-label="完整提示词" spellCheck={false} value={document} onChange={event => change(event.target.value)}/>
  </section>;
}
