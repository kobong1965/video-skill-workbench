import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { localPostgres, freePort } from './postgres';

const mode = process.argv[2] ?? 'unit';
const root = path.join(process.env.VSW_TEMP_ROOT!, 'tests', randomUUID());
// Only throwaway databases under the test temp root skip slow initdb fsync.
process.env.VSW_TEST_INIT_NOSYNC = '1';
await mkdir(root, { recursive: true });
const database = await localPostgres(path.join(root, 'postgres'));
const entry = mode === 'e2e' ? 'node_modules/@playwright/test/cli.js' : 'node_modules/vitest/vitest.mjs';
const command = mode === 'e2e' ? 'test' : 'run';
const testPort = await freePort();
try {
  const child = spawn(process.execPath, [entry, command, ...process.argv.slice(3)], {
    windowsHide: true, stdio: 'inherit',
    env: { ...process.env, VSW_DATABASE_URL: database.url, VSW_TEST_ROOT: root, VSW_E2E_PORT: String(testPort) },
  });
  process.exitCode = await new Promise<number>(resolve => child.on('exit', code => resolve(code ?? 1)));
} finally { await database.stop(); }
