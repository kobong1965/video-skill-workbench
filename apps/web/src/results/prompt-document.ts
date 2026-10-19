import { outputSchema, type PromptOutput } from '../../../../packages/contracts';

const fields = [
  ['title', '镜头名称'], ['duration', '时长（秒）'], ['prompt', '画面与动作'],
  ['dialogue', '广告台词'], ['translation', '台词中文意思'], ['storyAudio', '剧情及环境声音'],
  ['startState', '起始状态'], ['endState', '结束状态'],
] as const;
const marker = /^【[^】\r\n]+】$/;
const normalizeNewlines = (value: string) => value.replace(/\r\n/g, '\n');

function escapeBody(value: string) {
  return normalizeNewlines(value).split('\n').map(line => line.startsWith('\\') || marker.test(line) ? `\\${line}` : line).join('\n');
}

function unescapeBody(value: string) {
  return value.split('\n').map(line => line.startsWith('\\\\') || (line.startsWith('\\') && marker.test(line.slice(1))) ? line.slice(1) : line).join('\n');
}

function sections(output: PromptOutput) {
  return [
    { heading: '全片共用要求', value: output.globalPrompt },
    ...output.shots.flatMap((shot, index) => [
      { heading: `镜头 ${index + 1}`, value: '' },
      ...fields.map(([key, heading]) => ({ heading, value: String(shot[key]) })),
    ]),
  ];
}

/** A single readable document; escaped heading-like body lines cannot become structure. */
export function formatPromptDocument(output: PromptOutput): string {
  return sections(output).map(section => `【${section.heading}】\n${escapeBody(section.value)}`).join('\n\n');
}

/** Only editable fields change. Skill identities, references and planning metadata stay intact. */
export function parsePromptDocument(document: string, original: PromptOutput): PromptOutput {
  const text = normalizeNewlines(document);
  const expected = sections(original);
  const headings = [...text.matchAll(/^【[^】\r\n]+】$/gm)];
  const structureError = () => new Error('提示词段落结构已改变，请保留【全片共用要求】、各字段标题和镜头顺序后再保存。');
  if (headings.length !== expected.length || headings[0]?.index !== 0) throw structureError();
  const values = headings.map((heading, index) => {
    if (heading[0] !== `【${expected[index].heading}】`) throw structureError();
    const bodyStart = heading.index + heading[0].length;
    if (text[bodyStart] !== '\n') throw structureError();
    let body = text.slice(bodyStart + 1, headings[index + 1]?.index ?? text.length);
    if (index < headings.length - 1) {
      if (!body.endsWith('\n\n')) throw structureError();
      body = body.slice(0, -2);
    }
    return unescapeBody(body);
  });
  let cursor = 1;
  const output = structuredClone(original);
  output.globalPrompt = values[0];
  for (const [index, shot] of output.shots.entries()) {
    if (values[cursor++] !== '') throw structureError();
    for (const [key] of fields) {
      const value = values[cursor++];
      if (key === 'duration') {
        if (!/^\d+(?:\.\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) throw new Error(`镜头 ${index + 1} 的时长须填写有效秒数。`);
        shot.duration = Number(value);
      } else shot[key] = value;
    }
  }
  const checked = outputSchema.safeParse(output);
  if (!checked.success) throw new Error('提示词内容或时长超出范围，无法保存。请保留完整共用要求、镜头名称和画面内容，镜头时长为 0.5–300 秒。');
  return output;
}
