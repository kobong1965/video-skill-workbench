import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { parseSkillPackage } from '../packages/domain/skill-import';
import { getSkillRequirements } from '../packages/domain/skill-requirements';

const dataRoot = 'E:/Codex工作盘/projects/video-skill-workbench-data';
const archive = 'E:/Codex工作盘/downloads/archives/深灰阔腿裤_对标确认版_工作台导入包_20260912.zip';
const settings = JSON.parse(await readFile(path.join(dataRoot, 'postgres/postgres-local.json'), 'utf8'));
const db = new pg.Client({ host: '127.0.0.1', port: settings.port, user: 'postgres', password: settings.password, database: 'workbench' });
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
try {
  await db.connect(); await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const skills = (await db.query("SELECT s.id,s.name,s.visibility,v.id AS version_id,v.number,v.kind,v.duration FROM skills s JOIN skill_versions v ON v.skill_id=s.id WHERE s.name=$1", ['深灰阔腿裤｜对标视频确认版'])).rows;
  if (skills.length !== 1) throw new Error(`应有且仅有一个确认版，实际 ${skills.length}`);
  const skill = skills[0];
  if (skill.visibility !== 'private' || skill.kind !== 'full' || Number(skill.duration) !== 14) throw new Error('导入属性与确认版不符');
  const files = (await db.query('SELECT f.path,f.mime,f.text,f.media_id AS "mediaId",m.disk_path FROM skill_files f LEFT JOIN media m ON m.id=f.media_id WHERE version_id=$1 ORDER BY f.path', [skill.version_id])).rows;
  const original = await parseSkillPackage(await readFile(archive), path.basename(archive));
  if (files.length !== original.files.length) throw new Error('素材文件数量不一致');
  for (const file of files) {
    const expected = original.files.find(f => f.path === file.path);
    const bytes = file.disk_path ? await readFile(path.join(dataRoot, file.disk_path)) : Buffer.from(file.text, 'utf8');
    if (!expected || hash(bytes) !== hash(expected.bytes)) throw new Error(`素材内容变化：${file.path}`);
  }
  const requirements = getSkillRequirements(files);
  if (!requirements?.referenceVideoRequired || !requirements.benchmarkVideo?.mediaId || !requirements.benchmarkVideo.path.includes('/benchmark/')) throw new Error('原对标引用配置无效');
  await db.query('COMMIT');
  const report = { skill, verifiedFiles: files.length, filesUnchanged: true, requirements };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally { await db.end(); }
