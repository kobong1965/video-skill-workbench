import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { harness } from '../helpers';
import { mediaBytes, ownedMedia, saveMedia } from '../../packages/storage/private-files';
import { generateText } from '../../packages/providers/text';
import { getProvider } from '../../packages/providers/config';
import { requestBytes } from '../../packages/providers/network';
import { claimJob, runJob } from '../../apps/worker/queue';
import type { PromptOutput, TaskSnapshot } from '../../packages/contracts';

vi.mock('../../packages/providers/network', async original => ({ ...await original<typeof import('../../packages/providers/network')>(), requestBytes: vi.fn() }));
const request = vi.mocked(requestBytes);
let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let snapshot: TaskSnapshot;
let original: Buffer;

beforeAll(async () => {
  h = await harness('multi_provider', 'http://127.0.0.1:4178', true); owner = await h.account('admin');
  original = await sharp({ create: { width: 2200, height: 2800, channels: 3, background: '#4267a0' } }).png().toBuffer();
  const media: TaskSnapshot['media'] = [];
  for (let index = 0; index < 18; index++) {
    const saved = await saveMedia(h.context, owner.id, `图${index + 1}.png`, original);
    media.push({ id: saved.id, role: index % 6 ? 'detail' : 'product', name: saved.name, mime: saved.mime });
  }
  const skill = (await h.app.inject({ method: 'POST', url: '/api/skills', headers: owner.headers, payload: { name: '三组换色脚本', kind: 'full', duration: 9, text: '# 三组顺序换色' } })).json();
  snapshot = { input: { name: '十八图任务', media: media.map(({ id, role }) => ({ id, role: role as 'product' | 'detail' })), platform: 'tiktok', market: 'US', category: '服装', targetDuration: 9, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none', selections: [{ id: skill.id, versionId: skill.versionId, duration: 9 }], productName: '', facts: '', audience: '', personNotes: '', sceneNotes: '', extra: '', productUse: 'colors', productGroups: ['6258黑色', '6258深蓝', '6258浅蓝'].map((styleNumber, index) => ({ productSetId: skill.id, styleNumber, name: styleNumber, mediaIds: media.slice(index * 6, index * 6 + 6).map(item => item.id) })) }, media, skills: [{ id: skill.id, versionId: skill.versionId, name: '三组换色脚本', kind: 'full', duration: 9 }], capability: { min: 4, max: 30, source: 'test', checkedAt: '', verified: false } };
  await h.app.inject({ method: 'PUT', url: '/api/admin/providers/text', headers: owner.headers, payload: { enabled: true, protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'test-multicolor', apiKey: 'test-only', vision: true, jsonMode: true } });
});
afterEach(() => request.mockReset());
afterAll(async () => h.close());

it('十八图全部作为带分组标签的分析副本送到测试接口，保存的原图不变', async () => {
  request.mockResolvedValue(Buffer.from(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
  await generateText(h.context, owner.id, snapshot, (await getProvider(h.context, 'text'))!);
  expect(request).toHaveBeenCalledOnce();
  const body = JSON.parse(request.mock.calls[0][1]!.body as string);
  const content = body.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
  const images = content.filter(item => item.type === 'image_url');
  expect(images).toHaveLength(18);
  for (const label of ['6258黑色', '6258深蓝', '6258浅蓝']) expect(content.filter(item => item.type === 'text' && item.text?.startsWith('素材 ') && item.text.includes(label))).toHaveLength(6);
  const bytes = Buffer.from(images[0].image_url!.url.split(',')[1], 'base64');
  const dimensions = await sharp(bytes).metadata();
  expect(Math.max(dimensions.width!, dimensions.height!)).toBeLessThanOrEqual(1600);
  expect(await mediaBytes(h.context, await ownedMedia(h.context, snapshot.media[0].id, owner.id))).toEqual(original);
});

it('模型只引用第一组时结果留为可修正状态，不保存为成功，不自动再次请求', async () => {
  const taskId = (await h.db.query('INSERT INTO tasks(id,owner_id,name,snapshot) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING id', [owner.id, '遗漏颜色验收', snapshot])).rows[0].id;
  const response = await h.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/generate`, headers: owner.headers, payload: { key: crypto.randomUUID() } });
  expect(response.statusCode).toBe(200);
  const raw: PromptOutput = { globalPrompt: '真实服装多色展示，不能改变原商品结构', productFacts: [], unknowns: [], conflicts: [], assetPlan: [], shots: [{ skillVersionId: snapshot.skills[0].versionId, duration: 9, title: '遗漏两种颜色', prompt: '只展示第一组黑色裤装', dialogue: '', translation: '', storyAudio: '', startState: '', endState: '', references: [snapshot.media[0].id] }] };
  const provider = vi.fn(async () => raw);
  await runJob(h.context, (await claimJob(h.context))!, { text: provider });
  const job = (await h.db.query('SELECT status,error FROM jobs WHERE task_id=$1', [taskId])).rows[0];
  expect(job.status).toBe('invalid'); expect(job.error).toContain('6258深蓝'); expect(job.error).toContain('6258浅蓝');
  expect((await h.db.query('SELECT count(*)::int AS count FROM results WHERE task_id=$1', [taskId])).rows[0].count).toBe(0);
  expect(provider).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
});
