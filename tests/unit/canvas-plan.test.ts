import { describe, expect, it } from 'vitest';
import type { PromptOutput, TaskSnapshot } from '../../packages/contracts';
import { planCanvasImport, videoReferenceMode } from '../../packages/canvas/planner';
import { assertImportCommand } from '../../packages/canvas/cli';

const snapshot = {
  input: { market: 'US', voice: 'voiceover' }, capability: { min: 4, max: 15 },
  media: [{ id: 'product-1', role: 'product', name: '衣服.png', mime: 'image/png' }, { id: 'detail-1', role: 'detail', name: '细节.jpg', mime: 'image/jpeg' }],
} as TaskSnapshot;
const output: PromptOutput = {
  globalPrompt: '所有镜头保持人物、场景和商品完全一致，美式英语女声画外音。', productFacts: [], unknowns: [], conflicts: [], assetPlan: [],
  shots: [1, 2].map(i => ({ skillVersionId: 'skill', duration: 10, title: `镜头${i}`, prompt: `展示商品第${i}个角度。`, dialogue: `Look at this ${i}!`, translation: `看看这个${i}！`, storyAudio: '低音量鼓点和衣料摩擦声', startState: '站立', endState: '转身', references: ['product-1'] })),
};

describe('仅导入 LibTV 工作流', () => {
  it('按现有能力分批，保留完整画面、台词、译文、声音与商品，不指定生成模型', () => {
    const plan = planCanvasImport('abcdef12-1111-2222-3333-444444444444', snapshot, output, []);
    expect(plan.materials.map(x => x.id)).toEqual(['product-1', 'detail-1']);
    expect(plan.batches).toHaveLength(2);
    const allText = plan.batches.flatMap(x => x.texts.map(t => t.content)).join('\n');
    expect(allText).toContain(output.globalPrompt);
    for (const shot of output.shots) for (const text of [shot.prompt, shot.dialogue, shot.translation, shot.storyAudio, shot.startState, shot.endState]) expect(allText).toContain(text);
    expect(plan.batches[0].materialIds).toEqual(['product-1']);
    expect(plan.batches[1].video.name).not.toBe(plan.batches[0].video.name);
    expect(JSON.stringify(plan)).not.toContain('Seedance');
  });
  it('只接收当前版本已确认且未过期的固定资产，故事板不串批', () => {
    const plan = planCanvasImport('abcdef12', snapshot, output, [
      { id: 'person-1', kind: 'person', name: '人物', batch: null, mime: 'image/png' },
      { id: 'story-2', kind: 'storyboard', name: '第二批', batch: 2, mime: 'image/png' },
    ]);
    expect(plan.batches[0].materialIds).toEqual(['product-1', 'person-1']);
    expect(plan.batches[1].materialIds).toEqual(['product-1', 'person-1', 'story-2']);
  });
  it('很长的提示词拆为多个文本节点，内容完全保留', () => {
    const long = { ...output, globalPrompt: '商品真实自然光。'.repeat(4000) };
    const plan = planCanvasImport('long', snapshot, long, []);
    expect(plan.batches[0].texts.length).toBeGreaterThan(1);
    expect(plan.batches[0].texts.map(x => x.content).join('')).toContain(long.globalPrompt);
    expect(plan.batches[0].texts.every(x => x.content.length <= 10000)).toBe(true);
    expect(plan.batches[0].video.prompt.length).toBeLessThan(16000);
  });
  it('多个脚本即使能合成一批，也分别分批、复制共享商品图并建立独立分组', () => {
    const twoScripts = { ...snapshot, skills: [
      { id: 'one', versionId: 'skill-1', name: '第一套', kind: 'opening', duration: 5 },
      { id: 'two', versionId: 'skill-2', name: '第二套', kind: 'detail', duration: 5 },
    ] } as TaskSnapshot;
    const distinct = { ...output, shots: output.shots.map((shot, index) => ({ ...shot, duration: 5, skillVersionId: `skill-${index + 1}` })) };
    const plan = planCanvasImport('separate-scripts', twoScripts, distinct, []);
    expect(plan.batches).toHaveLength(2);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups!.map(group => group.name)).toEqual([expect.stringContaining('第一套'), expect.stringContaining('第二套')]);
    expect(plan.batches[0].groupKey).toBe(plan.groups![0].key);
    expect(plan.batches[1].groupKey).toBe(plan.groups![1].key);
    expect(plan.batches[0].materialIds).not.toContain(plan.batches[1].materialIds[0]);
    const first = plan.materials.find(material => material.id === plan.batches[0].materialIds[0]);
    const second = plan.materials.find(material => material.id === plan.batches[1].materialIds[0]);
    expect(first?.sourceId).toBe('product-1');
    expect(second?.sourceId).toBe('product-1');
    expect(first?.name).not.toBe(second?.name);
    expect(plan.batches[0].texts.map(text => text.content).join('')).toContain(distinct.shots[0].prompt);
    expect(plan.batches[0].texts.map(text => text.content).join('')).not.toContain(distinct.shots[1].prompt);
  });
  it('旧批次的分镜图或尾帧跨脚本时拒绝导入，不能静默绑定第一套脚本', () => {
    const distinct = { ...output, shots: output.shots.map((shot, index) => ({ ...shot, duration: 5, skillVersionId: `skill-${index + 1}` })) };
    for (const kind of ['storyboard', 'tailframe']) {
      expect(() => planCanvasImport('mixed-original-batch', snapshot, distinct, [
        { id: 'mixed-panel', kind, name: '旧第一批素材', batch: 1, mime: 'image/png' },
      ])).toThrow('分镜图/尾帧跨脚本，请按脚本重新确认素材');
    }
  });
  it('前一旧批次拆分后，后续完整旧批次的限定素材重映射到正确新批次', () => {
    const distinct = { ...output, shots: [10, 5, 15].map((duration, index) => ({ ...output.shots[0], duration, skillVersionId: `skill-${index + 1}`, prompt: `脚本${index + 1}独立展示。` })) };
    const plan = planCanvasImport('shifted-original-batch', snapshot, distinct, [
      { id: 'panel-2', kind: 'storyboard', name: '旧第二批分镜图', batch: 2, mime: 'image/png' },
      { id: 'tail-2', kind: 'tailframe', name: '旧第二批尾帧', batch: 2, mime: 'image/png' },
      { id: 'person', kind: 'person', name: '通用人物', batch: null, mime: 'image/png' },
    ]);
    expect(plan.batches).toHaveLength(3);
    const limited = plan.materials.filter(material => ['panel-2', 'tail-2'].includes(material.sourceId!));
    expect(limited).toHaveLength(2);
    expect(limited.every(material => material.batch === 3)).toBe(true);
    for (const material of limited) {
      expect(plan.batches[0].materialIds).not.toContain(material.id);
      expect(plan.batches[1].materialIds).not.toContain(material.id);
      expect(plan.batches[2].materialIds).toContain(material.id);
      expect(plan.groups![2].materialIds).toContain(material.id);
    }
    for (const batch of plan.batches) expect(batch.materialIds.some(id => plan.materials.find(material => material.id === id)?.sourceId === 'person')).toBe(true);
  });
  it('拒绝运行生成或执行任意外部命令', () => {
    expect(() => assertImportCommand(['node', 'create', '视频', '-t', 'video', '--run'])).toThrow();
    expect(() => assertImportCommand(['node', '视频', '-r'])).toThrow();
    expect(() => assertImportCommand(['group', '画布', '--run'])).toThrow();
    expect(() => assertImportCommand(['logout'])).toThrow();
    expect(() => assertImportCommand(['node', '--x', '700', '--y', '0', 'create', '视频', '-t', 'video', '--prompt', '自然光商品展示'])).not.toThrow();
    expect(() => assertImportCommand(['upload', '商品', '-t', 'image', '-p', 'project', '-f', 'E:/managed/product.png'])).not.toThrow();
    expect(() => assertImportCommand(['project', '60581fbf922b4ba9b7981186e8f73d21'])).not.toThrow();
  });
  it('必需原对标只连接到使用对应 Skill 的批次', () => {
    const distinct = { ...output, shots: output.shots.map((x, i) => ({ ...x, skillVersionId: `skill-${i + 1}` })) };
    const plan = planCanvasImport('refvideo', snapshot, distinct, [{ id: 'required-video', kind: 'benchmark', name: '原对标.mp4', batch: null, mime: 'video/mp4', skillVersionIds: ['skill-2'] }]);
    const benchmarkIds = plan.materials.filter(material => material.sourceId === 'required-video').map(material => material.id);
    expect(benchmarkIds).toHaveLength(1);
    expect(plan.batches[0].materialIds).not.toContain(benchmarkIds[0]);
    expect(plan.batches[1].materialIds).toContain(benchmarkIds[0]);
    expect(plan.batches[1].texts[0].content).toContain('必需原对标视频');
  });
  it('按平台默认模型实际能力选择参考模态，仍不选择模型', () => {
    const schema = { properties: { modeType: { items: { text2video: [0, 0], singleImage2video: [1, 1], image2video: [1, 9], mixed2video: [1, 12] } } } };
    expect(videoReferenceMode(schema, 1, 0)).toBe('singleImage2video');
    expect(videoReferenceMode(schema, 3, 0)).toBe('image2video');
    expect(videoReferenceMode(schema, 3, 1)).toBe('mixed2video');
    expect(() => videoReferenceMode({ properties: {} }, 3, 1)).toThrow('不支持');
  });
});
