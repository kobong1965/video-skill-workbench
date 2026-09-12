import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileDropzone, useFileNavigationGuard } from '../../apps/web/src/uploads/FileDropzone';
import type { UploadKind } from '../../apps/web/src/uploads/file-upload';
import '../../apps/web/src/theme.css';

// An isolated, user-visible harness. Never calls the API or modifies real data.
const cases: { label: string; kind: UploadKind; multiple?: boolean }[] = [
  { label: '商品主图', kind: 'image', multiple: true }, { label: '补充商品图', kind: 'image', multiple: true },
  { label: '导入脚本', kind: 'skill' }, { label: '脚本效果预览', kind: 'preview' },
  { label: '参考图库', kind: 'image' }, { label: '固定资产上传', kind: 'image' }, { label: '真实尾帧', kind: 'image' },
];
function TestZone({ label, kind, multiple }: typeof cases[number]) {
  const host = useRef<HTMLElement>(null); const finish = useRef<() => void>(() => {});
  const [received, setReceived] = useState<string[]>([]); const [disabled, setDisabled] = useState(false);
  function simulate(type: 'valid' | 'invalid' | 'many' | 'enter' | 'leave') {
    const transfer = new DataTransfer();
    const name = type === 'invalid' ? '不支持.exe' : kind === 'skill' ? '测试.md' : kind === 'preview' ? '效果.mp4' : '商品.png';
    for (let i = 0; i < (type === 'many' ? 2 : 1); i++) transfer.items.add(new File(['仅供事件测试'], `${i + 1}-${name}`));
    const target = host.current!.querySelector('.file-dropzone')!;
    target.dispatchEvent(new DragEvent(type === 'enter' ? 'dragenter' : type === 'leave' ? 'dragleave' : 'drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }
  return <section ref={host} aria-label={label} style={{ padding: 16, background: '#e5edff', borderRadius: 20 }}>
    <h2>{label}</h2>
    <FileDropzone label={label} kind={kind} multiple={multiple} maxFiles={2} disabled={disabled} onFiles={files => new Promise<void>(resolve => {
      setReceived(current => [...current, ...files.map(file => file.name)]); finish.current = resolve;
    })}/>
    <p role="status">收到 {received.length} 个：{received.join('、')}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button onClick={() => simulate('valid')}>模拟拖入</button><button onClick={() => simulate('many')}>拖入两个</button>
      <button onClick={() => simulate('invalid')}>拖入错误格式</button><button onClick={() => simulate('enter')}>拖入悬停</button>
      <button onClick={() => simulate('leave')}>拖出区域</button><button onClick={() => finish.current()}>完成测试上传</button>
      <button onClick={() => setDisabled(value => !value)}>{disabled ? '启用' : '禁用'}</button>
    </div>
  </section>;
}
function TestPage() {
  useFileNavigationGuard(); const [guard, setGuard] = useState('未检查');
  function checkGuard() {
    const transfer = new DataTransfer(); transfer.items.add(new File(['测试'], '测试.png'));
    const fileEvent = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    document.body.dispatchEvent(fileEvent);
    const textTransfer = new DataTransfer(); textTransfer.setData('text/plain', '普通文字');
    const textEvent = new DragEvent('drop', { dataTransfer: textTransfer, bubbles: true, cancelable: true });
    document.body.dispatchEvent(textEvent);
    setGuard(fileEvent.defaultPrevented && !textEvent.defaultPrevented ? '通过：文件不替换页面，文字不被拦截' : '失败');
  }
  return <main style={{ padding: 24 }}><h1>上传组件隔离验收</h1><p>仅测试组件事件，不连接真实账号、不上传到服务端、不调用 AI。</p>
    <button onClick={checkGuard}>检查页面防跳转</button><p role="status">{guard}</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>{cases.map(test => <TestZone key={test.label} {...test}/>)}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<TestPage/>);
