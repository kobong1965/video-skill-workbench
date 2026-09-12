import { describe, it, expect } from 'vitest';
import { planSelection, batchShots, localeFor, validateOutput } from '../../packages/domain/planning';

const hook = { id: 'h', versionId: 'v1', name: '开头', kind: 'opening' as const, duration: 3 };
const full = { ...hook, id: 'f', versionId: 'vf', name: '停车场上衣', kind: 'full' as const, duration: 17 };
describe('创作范围而非自动补全整片', () => {
  it('30 秒意图只选 3 秒开头仍为 3 秒', () => {
    expect(planSelection([hook], 30).selectedDuration).toBe(3);
  });
  it('全片与片段混选需用户解决冲突', () => {
    expect(() => planSelection([full, hook], 30)).toThrow('全片');
  });
  it('拒绝超目标时长、重复版本与未选脚本', () => {
    expect(() => planSelection([full], 10)).toThrow('时长');
    expect(() => planSelection([hook, hook], 30)).toThrow('重复');
    expect(() => planSelection([], 30)).toThrow('脚本');
  });
  it('独立保存片段顺序与调整秒数', () => {
    const plan = planSelection([hook, { ...hook, id: 'd', versionId: 'v2', duration: 6 }], 30);
    expect(plan.selectedDuration).toBe(9);
    expect(plan.items.map(x => x.id)).toEqual(['h', 'd']);
  });
});
describe('按镜头边界分批', () => {
  it('不机械截断动作且不扩写短开头', () => {
    expect(batchShots([{ duration: 3, prompt: '开头' }], { min: 4, max: 15 })[0]).toMatchObject({ duration: 3, generationDuration: 4 });
    expect(batchShots([6, 7, 5, 8].map(duration => ({ duration, prompt: '独立镜头' })), { min: 4, max: 15 }).map(x => x.duration)).toEqual([13, 13]);
  });
  it('单镜头超出能力上限报冲突而不是截断', () => {
    expect(() => batchShots([{ duration: 31, prompt: '完整对白' }], { min: 4, max: 30 })).toThrow('镜头');
  });
  it('市场语言明确映射', () => {
    expect(['CN', 'US', 'VN'].map(m => localeFor(m))).toEqual(['普通话', '美式英语', '越南语']);
    expect(() => localeFor('EU')).toThrow();
  });
});
describe('AI 输出边界', () => {
  const output = {
    productFacts: [{ text: '灰色', source: 'visible' }], unknowns: ['成分'], conflicts: [],
    globalPrompt: '自然阳光下拍摄，商品只参照产品图。',
    shots: [{ skillVersionId: 'v1', duration: 3, title: '开头', prompt: '手机近景呈现商品。', dialogue: '', translation: '', storyAudio: '环境风声', startState: '静止', endState: '转身', references: [] }],
    assetPlan: [],
  };
  it('接受对应版本与准确范围的中文镜头', () => {
    expect(validateOutput(output, [hook], 'none', 'CN').shots).toHaveLength(1);
  });
  it('拒绝 AI 擅自补齐时长、换版本或加入广告配音', () => {
    expect(() => validateOutput({ ...output, shots: [{ ...output.shots[0], duration: 30 }] }, [hook], 'none', 'CN')).toThrow();
    expect(() => validateOutput({ ...output, shots: [{ ...output.shots[0], skillVersionId: 'other' }] }, [hook], 'none', 'CN')).toThrow();
    expect(() => validateOutput({ ...output, shots: [{ ...output.shots[0], dialogue: '快购买' }] }, [hook], 'none', 'CN')).toThrow();
  });
});
