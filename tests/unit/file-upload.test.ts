import { describe, expect, it } from 'vitest';
import { validateUploadFiles, droppedFiles, isFileDrag, uploadSequentially } from '../../apps/web/src/uploads/file-upload';

const file = (name: string, size = 100) => ({ name, size }) as File;
describe('统一上传选择和拖入规则', () => {
  it('商品图允许多张、大小写扩展名和无 MIME 的 Windows 文件', () => {
    const files = [file('主图.PNG'), file('侧面.jpeg'), file('细节.webp')];
    expect(validateUploadFiles(files, 'image', 12)).toEqual(files);
  });
  it('无文件的点击取消不改变选择', () => expect(validateUploadFiles([], 'image')).toEqual([]));
  it('单文件入口不会悄悄丢弃第二个文件', () => {
    expect(() => validateUploadFiles([file('a.png'), file('b.png')], 'image')).toThrow('最多');
  });
  it('商品图总数限制包含已经上传的图片', () => {
    expect(() => validateUploadFiles([file('a.png'), file('b.png')], 'image', 1)).toThrow('最多');
    expect(() => validateUploadFiles([file('a.png')], 'image', 0)).toThrow('上限');
  });
  it('图片入口拒绝视频、文本、伪双扩展名和空文件', () => {
    for (const name of ['a.mp4', 'a.md', 'a.png.exe']) expect(() => validateUploadFiles([file(name)], 'image')).toThrow('格式');
    expect(() => validateUploadFiles([file('a.png', 0)], 'image')).toThrow('为空');
  });
  it('脚本仅接受 ZIP 或 MD，预览接受 MP4 或图片', () => {
    expect(validateUploadFiles([file('模板.zip')], 'skill')).toHaveLength(1);
    expect(validateUploadFiles([file('SKILL.md')], 'skill')).toHaveLength(1);
    expect(validateUploadFiles([file('效果.mp4')], 'preview')).toHaveLength(1);
    expect(() => validateUploadFiles([file('模板.txt')], 'skill')).toThrow('格式');
  });
  it('点击和拖入都遵循服务端的 20/2/150 MB 限制', () => {
    for (const [name, kind, mb] of [['a.png', 'image', 20], ['a.md', 'skill', 2], ['a.zip', 'skill', 150], ['a.mp4', 'preview', 150]] as const) {
      expect(validateUploadFiles([file(name, mb * 1024 * 1024)], kind)).toHaveLength(1);
      expect(() => validateUploadFiles([file(name, mb * 1024 * 1024 + 1)], kind)).toThrow(`${mb} MB`);
    }
  });
  it('混合有效和无效文件在发送前整批拒绝', () => {
    expect(() => validateUploadFiles([file('a.png'), file('危险.exe')], 'image', 12)).toThrow('危险.exe');
  });
  it('识别文件拖入但不拦截文本拖动', () => {
    expect(isFileDrag({ types: ['Files'] })).toBe(true);
    expect(isFileDrag({ types: ['text/plain'] })).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
  it('拒绝目录和无法读取的外部拖入', () => {
    expect(() => droppedFiles({ files: [], items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }] } as unknown as DataTransfer)).toThrow('文件夹');
    expect(() => droppedFiles({ files: [], items: [] } as unknown as DataTransfer)).toThrow('无法读取');
    const files = [file('a.png')];
    expect(droppedFiles({ files, items: [] } as unknown as DataTransfer)).toEqual(files);
  });
  it('批量中途失败仍逐张保留已成功结果，继续处理后面的文件', async () => {
    const saved: string[] = [];
    const result = await uploadSequentially([file('a.png'), file('b.png'), file('c.png')], async item => {
      if (item.name === 'b.png') throw new Error('连接中断');
      return item.name;
    }, item => { saved.push(item); });
    expect(saved).toEqual(['a.png', 'c.png']);
    expect(result.succeeded).toBe(2);
    expect(result.failures).toEqual(['b.png：连接中断']);
  });
});
