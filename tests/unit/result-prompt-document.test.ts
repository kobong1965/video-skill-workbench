import { describe, expect, it } from 'vitest';
import type { PromptOutput } from '../../packages/contracts';
import { renderPrompt } from '../../packages/domain/planning';
import { formatPromptDocument, parsePromptDocument } from '../../apps/web/src/results/prompt-document';

function example(): PromptOutput {
  return {
    globalPrompt: '全片保持商品和人物一致。\n采用自然光和美式英语画外音。',
    productFacts: [{ text: '黑色裤子', source: 'visible' }],
    unknowns: ['成分未知'], conflicts: ['颜色待核对'],
    assetPlan: [{ kind: 'scene', name: '客厅', prompt: '白天的真实美国家庭客厅。' }],
    shots: [1, 2].map(index => ({
      skillVersionId: `skill-${index}`, duration: index === 1 ? 4.13 : 8.151905,
      title: `商品镜头 ${index}`, prompt: `自然展示商品第 ${index} 个角度。\n保持细节。`,
      dialogue: index === 1 ? 'Look at this.' : '', translation: index === 1 ? '看看这个。' : '',
      storyAudio: '轻柔音乐\n布料摩擦声', startState: '正面站立', endState: '自然转身',
      references: ['product-1', `detail-${index}`],
    })),
  };
}

describe('统一提示词文档', () => {
  it('在一个文档中展示全部提示词字段，原样往返并保留所有后台元数据', () => {
    const output = example();
    const document = formatPromptDocument(output);
    for (const shot of output.shots) {
      for (const text of [shot.title, String(shot.duration), shot.prompt, shot.dialogue, shot.translation, shot.storyAudio, shot.startState, shot.endState]) {
        expect(document).toContain(text);
      }
    }
    expect(document).toContain(output.globalPrompt);
    expect(parsePromptDocument(document, output)).toEqual(output);
  });

  it('编辑全部可见字段后保存到对应镜头，复制与画布沿用同一完整输出', () => {
    const original = example(); const before = structuredClone(original);
    const document = formatPromptDocument(original)
      .replace('全片保持商品和人物一致。', '全片保持新商品一致，使用暖色自然光。')
      .replace('商品镜头 1', '开头展示')
      .replace('4.13', '4.5')
      .replace('自然展示商品第 1 个角度。', '模特从背面转身展示商品。')
      .replace('Look at this.', 'This is my favorite.')
      .replace('看看这个。', '这是我的最爱。')
      .replace('轻柔音乐', '轻快鼓点')
      .replace('正面站立', '背面站立')
      .replace('自然转身', '正面停留');
    const result = parsePromptDocument(document, original);
    expect(result.globalPrompt).toContain('新商品');
    expect(result.shots[0]).toMatchObject({ title: '开头展示', duration: 4.5, prompt: '模特从背面转身展示商品。\n保持细节。', dialogue: 'This is my favorite.', translation: '这是我的最爱。', storyAudio: '轻快鼓点\n布料摩擦声', startState: '背面站立', endState: '正面停留', skillVersionId: 'skill-1', references: ['product-1', 'detail-1'] });
    expect(result.shots[1]).toEqual(original.shots[1]);
    expect(result.productFacts).toEqual(original.productFacts);
    expect(result.unknowns).toEqual(original.unknowns);
    expect(result.conflicts).toEqual(original.conflicts);
    expect(result.assetPlan).toEqual(original.assetPlan);
    const rendered = renderPrompt(result);
    for (const text of ['新商品', '开头展示', '4.5', '模特从背面', 'This is my favorite.', '这是我的最爱。', '轻快鼓点', '背面站立', '正面停留']) expect(rendered).toContain(text);
    expect(rendered).not.toContain('自然展示商品第 1 个角度。');
    expect(original).toEqual(before);
  });

  it('保留空值、正文中的分段符、反斜线和首尾空白，不误当成编辑结构', () => {
    const output = example();
    output.globalPrompt = '  全片保持自然真实。\n【镜头 1】\n\\原始文本\n\n';
    output.shots[0].prompt = '\n【画面与动作】\n\\【全片共用要求】\n结束。  \n';
    output.shots[0].dialogue = '';
    expect(parsePromptDocument(formatPromptDocument(output), output)).toEqual(output);
  });

  it('接受 Windows 换行但不截短镜头内容', () => {
    const output = example();
    const result = parsePromptDocument(formatPromptDocument(output).replace(/\n/g, '\r\n'), output);
    expect(result).toEqual(output);
  });

  it.each([
    ['删除镜头', (value: string) => value.slice(0, value.indexOf('【镜头 2】'))],
    ['修改标题标记', (value: string) => value.replace('【画面与动作】', '【已删除的画面段落】')],
    ['添加未知段落', (value: string) => `${value}\n\n【新增镜头】\n不能静默丢弃`],
    ['添加开头游离内容', (value: string) => `额外要求\n${value}`],
    ['删除必需标记', (value: string) => value.replace('【广告台词】\n', '')],
    ['重复段落', (value: string) => value.replace('【台词中文意思】', '【广告台词】\n重复\n\n【台词中文意思】')],
    ['非数字时长', (value: string) => value.replace('4.13', '4.13秒')],
    ['时长无穷大', (value: string) => value.replace('4.13', 'Infinity')],
    ['时长低于范围', (value: string) => value.replace('4.13', '0')],
  ])('拒绝%s且不修改原始结果', (_name, edit) => {
    const original = example(); const before = structuredClone(original);
    expect(() => parsePromptDocument(edit(formatPromptDocument(original)), original)).toThrow();
    expect(original).toEqual(before);
  });
});
