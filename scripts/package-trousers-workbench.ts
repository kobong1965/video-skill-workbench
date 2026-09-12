import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseSkillPackage } from '../packages/domain/skill-import';

const original = 'E:/Codex工作盘/downloads/archives/深灰阔腿裤_对标视频版_已确认_Skill_20260912.zip';
const output = 'E:/Codex工作盘/downloads/archives/深灰阔腿裤_对标确认版_工作台导入包_20260912.zip';
const bytes = await readFile(original);
if (createHash('sha256').update(bytes).digest('hex') !== '3904c88127a222b970e86bc001268bcd452abe88b5d1dc4b93d42ac3ac6cb8a4') throw new Error('原确认包摘要不符，停止打包');
const files = unzipSync(bytes);
const main = Object.keys(files).find(name => name.endsWith('/SKILL.md'))!;
const root = main.slice(0, -'SKILL.md'.length);
const benchmarks = Object.keys(files).filter(name => name.startsWith(root + 'assets/benchmark/') && name.endsWith('.mp4'));
if (benchmarks.length !== 1) throw new Error('无法唯一确定原始对标');
files[root + 'workbench.json'] = strToU8(JSON.stringify({ referenceVideoRequired: true, benchmarkVideo: benchmarks[0].slice(root.length) }, null, 2));
const archive = zipSync(files, { level: 6 });
await parseSkillPackage(Buffer.from(archive), 'workbench.zip');
const check = unzipSync(archive);
for (const [name, content] of Object.entries(unzipSync(bytes))) {
  if (!Buffer.from(content).equals(Buffer.from(check[name]))) throw new Error(`原件被改动：${name}`);
}
await writeFile(output, archive, { flag: 'wx' });
console.log(JSON.stringify({ output, entries: Object.keys(files).length, preservedOriginalFiles: Object.keys(files).length - 1, sha256: createHash('sha256').update(archive).digest('hex') }));
