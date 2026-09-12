import { zipSync } from 'fflate';
import { parseSkillPackage } from '../packages/domain/skill-import';

export function publicRelativePath(value: string) {
  const parts = value.split('/');
  if (!value || value.length > 250 || /[\\:\x00-\x1f]/.test(value) || parts.some(part => !part || part === '.' || part === '..'
    || /^(?:\.env(?:\..*)?|\.git|desktop-profile|local-secrets\.json|postgres-local\.json|本机安装码\.txt)$/i.test(part))
    || /^(?:Cookies|Login Data)(?:-journal|-wal|-shm)?$/i.test(parts.at(-1)!)) {
    throw new Error('Unsafe or private release path');
  }
  return value;
}

export function assertPublicText(value: string, label: string) {
  const patterns = [
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/,
    /[?&](?:access_token|token|api_key|X-Amz-Signature|X-Goog-Signature)=[^\s&#"<>]{12,}/i,
  ];
  if (patterns.some(pattern => pattern.test(value))) throw new Error(`Possible credential in ${label}; publication blocked`);
}

export function sanitizeDependencyDocumentation(bytes: Buffer, relative: string) {
  if (!relative.includes('/node_modules/') || !/\.md$/i.test(relative)) return bytes;
  const text = bytes.toString('utf8').replace(/https:\/\/codecov\.io\/[^\s)"<>]+\/badge\.svg\?[^\s)"<>]+/g, value => {
    const url = new URL(value);
    url.searchParams.delete('token');
    return url.toString();
  });
  return Buffer.from(text, 'utf8');
}

export function publicSkillMetadata(value: Record<string, unknown>) {
  return { name: value.name, tags: value.tags, version: Number(value.number), kind: value.kind, duration: Number(value.duration), source: value.source };
}

export interface ExportFile { path: string; text: string | null; media_id: string | null; }

export async function createSkillExport(text: string, files: ExportFile[], readMedia: (id: string) => Promise<Buffer>) {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const seen = new Set<string>();
  for (const file of files) {
    const name = publicRelativePath(file.path);
    if (seen.has(name.toLowerCase())) throw new Error('Duplicate archive path');
    seen.add(name.toLowerCase());
    if (file.text !== null) {
      assertPublicText(file.text, name);
      entries[name] = Buffer.from(file.text, 'utf8');
    } else {
      if (!file.media_id) throw new Error(`Missing media: ${name}`);
      entries[name] = await readMedia(file.media_id);
    }
  }
  const archive = Buffer.from(zipSync(entries, { level: 6 }));
  const parsed = await parseSkillPackage(archive, 'release-skill.zip');
  if (parsed.text !== text) throw new Error('Exported main script differs from the saved version');
  if (parsed.missing.length) throw new Error(`Missing references: ${parsed.missing.join(', ')}`);
  return { archive, entries, parsed };
}
