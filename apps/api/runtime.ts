import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDatabase, migrate } from '../../packages/storage/database';
import type { AppContext } from './context';

// An explicit per-install preference only preserves an existing local desktop
// mode. Missing, unreadable or malformed preferences keep normal session auth.
export async function readLocalOwnerMode(dataRoot: string, singleUserMode: boolean, origin: string): Promise<boolean> {
  if (!singleUserMode || origin !== 'http://127.0.0.1:4178') return false;
  try {
    const value: unknown = JSON.parse(await readFile(path.join(dataRoot, 'desktop-preferences.json'), 'utf8'));
    return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).localOwnerMode === true);
  } catch { return false; }
}

export async function runtimeContext(): Promise<AppContext> {
  const dataRoot = process.env.VSW_DATA_ROOT;
  const databaseUrl = process.env.VSW_DATABASE_URL;
  if (!dataRoot || !path.isAbsolute(dataRoot) || !databaseUrl) throw new Error('必须显式设置持久数据目录和数据库连接');
  await mkdir(dataRoot, { recursive: true });
  const secretFile = path.join(dataRoot, 'local-secrets.json');
  let secrets: { masterKey: string; setupKey: string };
  try { secrets = JSON.parse(await readFile(secretFile, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    secrets = { masterKey: randomBytes(32).toString('hex'), setupKey: randomBytes(18).toString('base64url') };
    await writeFile(secretFile, JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(dataRoot, '本机安装码.txt'), `首次开通工作台时填写以下安装码。请勿转发；开通后失效。\n\n${secrets.setupKey}\n`, { flag: 'wx', mode: 0o600 });
  }
  const db = createDatabase(databaseUrl); await migrate(db);
  const origin = process.env.VSW_ORIGIN ?? 'http://127.0.0.1:4178';
  const singleUserMode = process.env.VSW_SINGLE_USER !== '0';
  const localOwnerMode = await readLocalOwnerMode(dataRoot, singleUserMode, origin);
  return { db, dataRoot, ...secrets, origin, singleUserMode, localOwnerMode };
}
