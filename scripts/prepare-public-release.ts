import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { unzipSync } from 'fflate';
import pg from 'pg';
import { publicRelativePath, publicSkillMetadata, assertPublicText, createSkillExport, sanitizeDependencyDocumentation } from './public-release-safety';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve('E:/Codex工作盘');
function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  const value = path.resolve(process.argv[index + 1]);
  if (!value.toLowerCase().startsWith(work.toLowerCase() + path.sep)) throw new Error(`${name} must be inside E:/Codex工作盘`);
  return value;
}
const output = argument('--output-root');
const repository = argument('--repository-root');
const installed = argument('--installed-root');
const data = argument('--data-root');
const version = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version as string;
const allInOne = path.join(output, `VideoSkillWorkbench-${version}-AllInOne`);
const materials = path.join(allInOne, 'SkillsAndMaterials');
const settings = JSON.parse(await readFile(path.join(data, 'postgres/postgres-local.json'), 'utf8'));
const secrets = JSON.parse(await readFile(path.join(data, 'local-secrets.json'), 'utf8'));
const privateValues = [settings.password, ...Object.values(secrets)].filter(value => typeof value === 'string' && value.length >= 12) as string[];
const sha = (bytes: Buffer | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function inspectText(bytes: Buffer, name: string) {
  const text = bytes.toString('utf8');
  assertPublicText(text, name);
  if (privateValues.some(secret => text.includes(secret))) throw new Error(`Private local value found in ${name}`);
}
async function writeNew(root: string, relative: string, bytes: Buffer | Uint8Array | string) {
  const target = path.join(root, publicRelativePath(relative));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
}
const db = new pg.Client({ host: '127.0.0.1', port: settings.port, user: 'postgres', password: settings.password, database: 'workbench' });
await mkdir(output, { recursive: false });
await mkdir(repository, { recursive: false });
await db.connect();
try {
  // Snapshot only explicitly approved content tables; never export the database.
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const versions = (await db.query('SELECT s.id skill_id,s.name,s.tags,v.id,v.number,v.kind,v.duration,v.text,v.source FROM skills s JOIN skill_versions v ON v.skill_id=s.id ORDER BY s.created_at DESC,v.number DESC')).rows;
  const savedFiles = (await db.query('SELECT version_id,path,text,media_id FROM skill_files ORDER BY path')).rows;
  const media = (await db.query('SELECT id,name,mime,size,digest,disk_path FROM media ORDER BY created_at')).rows;
  await db.query('COMMIT');
  const mediaMap = new Map(media.map(row => [row.id, row]));
  async function loadMedia(id: string) {
    const row = mediaMap.get(id);
    if (!row) throw new Error('Missing saved media');
    const absolute = path.resolve(data, row.disk_path);
    if (!absolute.startsWith(path.join(data, 'media') + path.sep) || (await lstat(absolute)).isSymbolicLink()) throw new Error('Unsafe media path');
    const bytes = await readFile(absolute);
    if (bytes.length !== Number(row.size) || !timingSafeEqual(Buffer.from(sha(bytes)), Buffer.from(row.digest))) throw new Error('Media digest mismatch');
    return bytes;
  }
  const names = new Map([
    ['深灰阔腿裤｜对标视频确认版', 'trousers-benchmark-approved'],
    ['沥青躺拍裤装', 'asphalt-pants-laydown'],
    ['停车场上衣', 'parking-lot-top'],
    ['惊讶+321倒数', 'warehouse-countdown-reveal'],
  ]);
  const seen = new Set<string>();
  const catalog = [];
  for (const saved of versions) {
    const slug = names.get(saved.name);
    if (!slug) throw new Error(`Unreviewed skill: ${saved.name}`);
    const current = !seen.has(saved.skill_id); seen.add(saved.skill_id);
    const exported = await createSkillExport(saved.text, savedFiles.filter(file => file.version_id === saved.id), loadMedia);
    const folder = `${current ? 'current' : 'history'}/${slug}-v${saved.number}`;
    const archive = `import-packages/${current ? 'current' : 'history'}/${slug}-v${saved.number}.zip`;
    for (const [name, bytes] of Object.entries(exported.entries)) {
      if (/\.(md|txt|json|yaml|yml)$/i.test(name)) inspectText(Buffer.from(bytes), name);
      await writeNew(materials, `${folder}/${name}`, bytes);
      await writeNew(repository, `skills/${folder}/${name}`, bytes);
    }
    await writeNew(materials, archive, exported.archive);
    const metadata = { ...publicSkillMetadata(saved), status: current ? 'current' : 'history', folder, archive, sha256: sha(exported.archive), files: exported.parsed.files.length };
    catalog.push(metadata);
    console.log(JSON.stringify({ exported: saved.name, version: saved.number, current, files: exported.parsed.files.length, bytes: exported.archive.length }));
  }
  const mediaCatalog = [];
  for (const [index, row] of media.entries()) {
    const bytes = await loadMedia(row.id);
    if (row.mime === 'application/zip') {
      const content = unzipSync(bytes);
      for (const [name, entry] of Object.entries(content)) {
        publicRelativePath(name.replace(/\/$/, ''));
        if (/\.(md|txt|json|yaml|yml)$/i.test(name)) inspectText(Buffer.from(entry), `${row.name}/${name}`);
        if (/\.(exe|cmd|bat|ps1|dll|sqlite|dump)$/i.test(name)) throw new Error('Unreviewed executable or data in saved archive');
      }
    } else if (row.mime === 'text/markdown') inspectText(bytes, row.name);
    const filename = row.name.split(/[/\\]/).pop()!;
    const relative = `${String(index + 1).padStart(2, '0')}/${filename}`;
    await writeNew(materials, `materials/${relative}`, bytes);
    await writeNew(repository, `materials/${relative}`, bytes);
    mediaCatalog.push({ file: `materials/${relative}`, mime: row.mime, bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = { version, exportedAt: new Date().toISOString(), softwareIncludesUserData: false, skills: catalog, media: mediaCatalog, counts: { skills: seen.size, versions: catalog.length, savedFileEntries: savedFiles.length, savedMedia: media.length } };
  const manifestText = JSON.stringify(manifest, null, 2);
  await writeNew(materials, 'catalog.json', manifestText);
  await writeNew(repository, 'catalog.json', manifestText);
  // Copy only files already in the verified installed-package manifest.
  const packageManifest = JSON.parse(await readFile(path.join(installed, 'package-manifest.json'), 'utf8'));
  if (packageManifest.version !== version || packageManifest.includesUserData !== false) throw new Error('Installed package version/data boundary mismatch');
  const sanitizedDocumentation: string[] = [];
  for (const entry of packageManifest.files as {path: string; sha256: string; size: number}[]) {
    const relative = publicRelativePath(entry.path);
    const source = path.join(installed, relative);
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Unexpected installed link');
    let bytes: Buffer = await readFile(source);
    if (sha(bytes) !== entry.sha256) throw new Error(`Installed file changed: ${relative}`);
    const sanitized = sanitizeDependencyDocumentation(bytes, relative);
    if (!sanitized.equals(bytes)) {
      bytes = sanitized; entry.sha256 = sha(bytes); entry.size = bytes.length;
      sanitizedDocumentation.push(relative);
    }
    if (/\.(ts|js|mjs|json|html|css|ps1|cmd|txt|md)$/i.test(relative)) inspectText(bytes, relative);
    await writeNew(path.join(allInOne, 'Windows'), relative, bytes);
  }
  packageManifest.publicRelease = { sanitizedDocumentation, note: 'Removed third-party coverage badge token parameters from documentation only; application binaries unchanged.' };
  await writeNew(path.join(allInOne, 'Windows'), 'package-manifest.json', JSON.stringify(packageManifest, null, 2));
  // Source publication uses a separate copy, not the running app's data or private reports.
  async function sourceTree(relative: string) {
    publicRelativePath(relative);
    const source = path.join(project, relative);
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error('Do not publish source links');
    if (info.isDirectory()) {
      for (const name of await readdir(source)) {
        if (['node_modules', 'bin', 'obj', '.cache', '.vite', '.vite-temp'].includes(name)) continue;
        await sourceTree(`${relative}/${name}`);
      }
    } else {
      const bytes = await readFile(source);
      if (/\.(ts|tsx|js|mjs|json|html|css|ps1|cmd|txt|md|sql|cs|csproj|props|svg|ya?ml)$/i.test(relative)) inspectText(bytes, relative);
      await writeNew(repository, relative, bytes);
    }
  }
  for (const entry of ['apps', 'packages', 'database', 'desktop', 'scripts', 'tests', 'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'playwright.config.ts', 'Open-Workbench.cmd']) await sourceTree(entry);
  await writeNew(output, 'preparation-report.json', JSON.stringify({ version, counts: manifest.counts, softwareFiles: packageManifest.files.length, softwareBytes: packageManifest.files.reduce((sum: number, row: {size: number}) => sum + row.size, 0), repository, allInOne, privateDataExported: false }, null, 2));
  console.log(JSON.stringify({ prepared: allInOne, repository, counts: manifest.counts, softwareFiles: packageManifest.files.length }));
} finally { await db.end(); }
