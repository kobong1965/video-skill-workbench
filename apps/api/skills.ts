import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { skillKinds, type SkillInfo, type User } from '../../packages/contracts';
import { parseSkillPackage, findMissingReferences } from '../../packages/domain/skill-import';
import { ownedMedia, mediaBytes, saveMedia } from '../../packages/storage/private-files';
import { transaction } from '../../packages/storage/database';
import { AppError, type AppContext, type Routes } from './context';
import { getSkillRequirements } from '../../packages/domain/skill-requirements';

const metadata = z.object({ name: z.string().trim().min(1).max(100), tags: z.array(z.string().max(30)).max(12).default([]), visibility: z.enum(['private', 'public']).default('private'), sharingConfirmed: z.boolean().default(false) });
const versionInput = z.object({ kind: z.enum(skillKinds), duration: z.number().min(0.5).max(300), source: z.string().max(500).default(''), mediaId: z.string().uuid().optional(), text: z.string().min(1).max(150000).optional() });
function checkSharing(visibility: string, confirmed: boolean, user: User) {
  if (visibility === 'public' && (user.role !== 'admin' || !confirmed)) throw new AppError(403, '公共脚本需由管理员确认有权共享后保存');
}
export async function skillDetail(context: AppContext, user: User, id: string, versionId?: string): Promise<SkillInfo> {
  const base = (await context.db.query(`SELECT s.*,v.id AS version_id,v.number,v.kind,v.duration,v.text,v.source,v.missing FROM skills s JOIN skill_versions v ON v.skill_id=s.id WHERE s.id=$1 AND (s.owner_id=$2 OR s.visibility='public') AND ($3::uuid IS NULL OR v.id=$3) ORDER BY v.number DESC LIMIT 1`, [id, user.id, versionId ?? null])).rows[0];
  if (!base) throw new AppError(404, '脚本不存在或无权访问');
  const files = (await context.db.query('SELECT path,mime,media_id AS "mediaId",text FROM skill_files WHERE version_id=$1 ORDER BY path', [base.version_id])).rows;
  return { id: base.id, ownerId: base.owner_id, name: base.name, tags: base.tags, visibility: base.visibility, versionId: base.version_id, version: base.number, kind: base.kind, duration: Number(base.duration), text: base.text, source: base.source, missing: base.missing, files, requirements: getSkillRequirements(files) };
}
async function versionData(context: AppContext, user: User, input: z.infer<typeof versionInput>) {
  if (input.mediaId) {
    const media = await ownedMedia(context, input.mediaId, user.id);
    const parsed = await parseSkillPackage(await mediaBytes(context, media), media.name).catch(error => { throw new AppError(400, (error as Error).message); });
    const files: { path: string; mime: string; text?: string | null; mediaId: string | null }[] = [];
    for (const file of parsed.files) {
      const saved = file.text === undefined ? await saveMedia(context, user.id, file.path, file.bytes) : null;
      files.push({ path: file.path, mime: file.mime, text: file.text ?? null, mediaId: saved?.id ?? null });
    }
    return { text: parsed.text, missing: parsed.missing, sourceMediaId: input.mediaId, files };
  }
  if (!input.text) throw new AppError(400, '请导入脚本文件或填写正文');
  const parsed = await parseSkillPackage(Buffer.from(input.text), 'SKILL.md');
  return { text: input.text, missing: parsed.missing, sourceMediaId: null, files: [{ path: 'SKILL.md', mime: 'text/markdown', text: input.text, mediaId: null as string | null }] };
}
export const registerSkills: Routes = async (app, context) => {
  const { db } = context;
  app.post('/api/skills/inspect', async request => {
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.body);
    const media = await ownedMedia(context, mediaId, request.user.id);
    const result = await parseSkillPackage(await mediaBytes(context, media), media.name).catch(error => { throw new AppError(400, (error as Error).message); });
    return { ...result, files: result.files.map(({ bytes, ...file }) => ({ ...file, size: bytes.length })) };
  });
  app.get('/api/skills', async request => {
    const ids = (await db.query("SELECT id FROM skills WHERE owner_id=$1 OR visibility='public' ORDER BY created_at DESC", [request.user.id])).rows;
    const details = await Promise.all(ids.map(x => skillDetail(context, request.user, x.id)));
    return details.map(({ text, files, ...info }) => ({ ...info, text: '', files: files.map(({ text: _, ...file }) => file) }));
  });
  app.get('/api/skills/:id', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { version } = z.object({ version: z.string().uuid().optional() }).parse(request.query);
    const detail = await skillDetail(context, request.user, id, version);
    const versions = (await db.query('SELECT id,number,created_at AS "createdAt" FROM skill_versions WHERE skill_id=$1 ORDER BY number DESC', [id])).rows;
    return { ...detail, versions };
  });
  app.post('/api/skills', async request => {
    const input = metadata.merge(versionInput).parse(request.body);
    checkSharing(input.visibility, input.sharingConfirmed, request.user);
    const data = await versionData(context, request.user, input);
    const id = randomUUID(); const versionId = randomUUID();
    await transaction(db, async client => {
      await client.query('INSERT INTO skills(id,owner_id,name,tags,visibility) VALUES($1,$2,$3,$4,$5)', [id, request.user.id, input.name, JSON.stringify(input.tags), input.visibility]);
      await client.query('INSERT INTO skill_versions(id,skill_id,number,kind,duration,text,source,missing,source_media_id) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)', [versionId, id, input.kind, input.duration, data.text, input.source, JSON.stringify(data.missing), data.sourceMediaId]);
      for (const file of data.files) await client.query('INSERT INTO skill_files(version_id,path,mime,media_id,text) VALUES($1,$2,$3,$4,$5)', [versionId, file.path, file.mime, file.mediaId, file.text]);
    });
    return skillDetail(context, request.user, id);
  });
  app.post('/api/skills/:id/versions', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const prior = await skillDetail(context, request.user, id);
    if (prior.ownerId !== request.user.id || (prior.visibility === 'public' && request.user.role !== 'admin')) throw new AppError(403, '不能修改他人的原稿，请另存私人副本');
    const input = versionInput.parse(request.body);
    const data = await versionData(context, request.user, input);
    const versionId = randomUUID();
    const mainPath = prior.files.find(f => /(^|\/)SKILL\.md$/i.test(f.path))?.path ?? prior.files.find(f => /\.md$/i.test(f.path))?.path;
    const files = input.mediaId ? data.files : prior.files.map(f => ({ ...f, text: f.path === mainPath ? data.text : f.text }));
    let missing: string[];
    try { missing = findMissingReferences(files); } catch (error) { throw new AppError(400, (error as Error).message); }
    await transaction(db, async client => {
      await client.query('SELECT id FROM skills WHERE id=$1 FOR UPDATE', [id]);
      const number = Number((await client.query('SELECT max(number) AS number FROM skill_versions WHERE skill_id=$1', [id])).rows[0].number) + 1;
      await client.query('INSERT INTO skill_versions(id,skill_id,number,kind,duration,text,source,missing,source_media_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [versionId, id, number, input.kind, input.duration, data.text, input.source, JSON.stringify(missing), data.sourceMediaId]);
      for (const file of files) await client.query('INSERT INTO skill_files(version_id,path,mime,media_id,text) VALUES($1,$2,$3,$4,$5)', [versionId, file.path, file.mime, file.mediaId ?? null, file.text ?? null]);
    });
    return skillDetail(context, request.user, id);
  });
  app.patch('/api/skills/:id', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const prior = await skillDetail(context, request.user, id); const input = metadata.parse(request.body);
    if (prior.ownerId !== request.user.id) throw new AppError(403, '不能修改他人的脚本');
    checkSharing(input.visibility, input.sharingConfirmed || prior.visibility === 'public', request.user);
    await db.query('UPDATE skills SET name=$1,tags=$2,visibility=$3 WHERE id=$4', [input.name, JSON.stringify(input.tags), input.visibility, id]);
    return { ok: true };
  });
  app.post('/api/skills/:id/preview', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const prior = await skillDetail(context, request.user, id);
    if (prior.ownerId !== request.user.id) throw new AppError(403, '只能给自己的脚本补传预览');
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.body);
    const media = await ownedMedia(context, mediaId, request.user.id);
    if (!/^(image|video)\//.test(media.mime)) throw new AppError(400, '请选择效果视频或封面图片');
    await db.query('INSERT INTO skill_files(version_id,path,mime,media_id) VALUES($1,$2,$3,$4)', [prior.versionId, `previews/${media.id}/${media.name}`, media.mime, media.id]);
    return { ok: true };
  });
  app.post('/api/skills/:id/fork', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const prior = await skillDetail(context, request.user, id);
    const newId = randomUUID(); const versionId = randomUUID();
    const files: { path: string; mime: string; text?: string | null; mediaId: string | null }[] = [];
    for (const file of prior.files) {
      let mediaId: string | null = null;
      if (file.mediaId) {
        const media = (await db.query('SELECT * FROM media WHERE id=$1', [file.mediaId])).rows[0];
        mediaId = (await saveMedia(context, request.user.id, media.name, await mediaBytes(context, media))).id;
      }
      files.push({ ...file, mediaId });
    }
    await transaction(db, async client => {
      await client.query("INSERT INTO skills(id,owner_id,name,tags,visibility) VALUES($1,$2,$3,$4,'private')", [newId, request.user.id, `${prior.name} · 副本`, JSON.stringify(prior.tags)]);
      await client.query('INSERT INTO skill_versions(id,skill_id,number,kind,duration,text,source,missing) VALUES($1,$2,1,$3,$4,$5,$6,$7)', [versionId, newId, prior.kind, prior.duration, prior.text, `复制自 ${id} / v${prior.version}`, JSON.stringify(prior.missing)]);
      for (const file of files) await client.query('INSERT INTO skill_files(version_id,path,mime,media_id,text) VALUES($1,$2,$3,$4,$5)', [versionId, file.path, file.mime, file.mediaId, file.text ?? null]);
    });
    return skillDetail(context, request.user, newId);
  });
};
