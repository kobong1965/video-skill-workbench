import { outputSchema, type SelectedSkill, type PromptOutput } from '../contracts';

export function planSelection(items: SelectedSkill[], targetDuration: number) {
  if (!items.length) throw new Error('请先选择脚本');
  if (new Set(items.map(x => x.versionId)).size !== items.length) throw new Error('不能重复选择同一脚本版本');
  if (items.length > 1 && items.some(x => x.kind === 'full')) throw new Error('全片脚本不能直接与片段混用，请选择一个全片或改用片段组合');
  if (items.some(x => !Number.isFinite(x.duration) || x.duration <= 0)) throw new Error('片段时长无效');
  const selectedDuration = Math.round(items.reduce((sum, x) => sum + x.duration, 0) * 100) / 100;
  if (selectedDuration > targetDuration + 0.01) throw new Error(`已选内容 ${selectedDuration} 秒超过目标时长 ${targetDuration} 秒，请调整时长或片段`);
  return { items: [...items], selectedDuration, targetDuration };
}

export function localeFor(market: string) {
  const locale = ({ CN: '普通话', US: '美式英语', VN: '越南语' } as Record<string, string>)[market];
  if (!locale) throw new Error('请选择具体目标市场');
  return locale;
}

export function batchShots<T extends { duration: number; prompt: string }>(shots: T[], capability: { min: number; max: number }) {
  if (capability.min <= 0 || capability.max < capability.min) throw new Error('模型能力配置无效');
  const batches: { number: number; duration: number; generationDuration: number; shots: T[]; note: string }[] = [];
  let current: T[] = [];
  let duration = 0;
  const push = () => {
    if (!current.length) return;
    const rounded = Math.round(duration * 100) / 100;
    batches.push({ number: batches.length + 1, duration: rounded, generationDuration: Math.max(rounded, capability.min), shots: current,
      note: rounded < capability.min ? `创意内容仅 ${rounded} 秒；平台若要求至少 ${capability.min} 秒，可延长静止保持并剪取所需范围，不增加剧情。` : '' });
    current = []; duration = 0;
  };
  for (const shot of shots) {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) throw new Error('镜头时长无效');
    if (shot.duration > capability.max) throw new Error(`单个镜头 ${shot.duration} 秒超过单次上限 ${capability.max} 秒，请在动作或对白结束处拆开此镜头`);
    if (duration + shot.duration > capability.max + 0.01) push();
    current.push(shot); duration += shot.duration;
  }
  push(); return batches;
}

export function validateOutput(raw: unknown, skills: SelectedSkill[], voice: string, market: string): PromptOutput {
  const result = outputSchema.parse(raw);
  if (!/[\u3400-\u9fff]/u.test(result.globalPrompt) || result.shots.some(x => !/[\u3400-\u9fff]/u.test(x.prompt))) throw new Error('镜头提示词必须使用中文');
  const allowed = new Set(skills.map(x => x.versionId));
  if (result.shots.some(x => !allowed.has(x.skillVersionId))) throw new Error('结果包含未选择的脚本版本');
  for (const skill of skills) {
    const length = result.shots.filter(s => s.skillVersionId === skill.versionId).reduce((sum, shot) => sum + shot.duration, 0);
    if (Math.abs(length - skill.duration) > 0.15) throw new Error(`脚本 ${skill.name} 的输出时长 ${length} 秒与所选 ${skill.duration} 秒不符`);
  }
  const order = result.shots.map(s => skills.findIndex(x => x.versionId === s.skillVersionId));
  if (order.some((value, index) => index > 0 && value < order[index - 1])) throw new Error('输出改变了已选择的脚本顺序');
  if (voice === 'none' && result.shots.some(x => x.dialogue.trim())) throw new Error('已关闭广告配音，结果仍含广告台词');
  if (market !== 'CN' && result.shots.some(x => x.dialogue.trim() && !x.translation.trim())) throw new Error('当地语言台词必须附中文意思');
  return result;
}

export function speechWarnings(result: PromptOutput, market: string) {
  return result.shots.flatMap((shot, index) => {
    const words = market === 'CN' ? shot.dialogue.length : shot.dialogue.trim().split(/\s+/).filter(Boolean).length;
    const allowance = shot.duration * (market === 'CN' ? 4.5 : 2.8);
    return words > allowance ? [`镜头 ${index + 1} 的台词可能来不及说完，请缩短台词或调整该段时长。`] : [];
  });
}

export function renderPrompt(output: PromptOutput, shots = output.shots) {
  let cursor = 0;
  return [output.globalPrompt, ...shots.map((shot, i) => {
    const start = cursor; cursor = Math.round((cursor + shot.duration) * 100) / 100;
    return [`镜头 ${i + 1}｜${start}–${cursor} 秒｜${shot.title}`, shot.prompt,
      shot.startState && `起始状态：${shot.startState}`, shot.endState && `结束状态：${shot.endState}`,
      shot.dialogue && `台词：${shot.dialogue}`, shot.translation && `中文意思：${shot.translation}`,
      shot.storyAudio && `剧情及环境声音：${shot.storyAudio}`].filter(Boolean).join('\n');
  })].join('\n\n');
}
