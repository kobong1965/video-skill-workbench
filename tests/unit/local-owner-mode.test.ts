import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerAuth } from '../../apps/api/auth';
import { readLocalOwnerMode } from '../../apps/api/runtime';
import type { AppContext } from '../../apps/api/context';

const origin = 'http://127.0.0.1:4178';
const existingOwner = { id: '00000000-0000-4000-8000-000000000001', username: 'existing-owner', displayName: 'Existing owner', role: 'admin', active: true };
const applications: FastifyInstance[] = [];
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(app => app.close()));
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(tempRoot)) throw new Error('Unexpected test cleanup path');
    await rm(folder, { recursive: true, force: true });
  }
});

async function fixture(overrides: Partial<AppContext> = {}) {
  let enabledOwner = true;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("role='admin' AND active=true")) return { rows: enabledOwner ? [existingOwner] : [], rowCount: enabledOwner ? 1 : 0 };
    if (sql.startsWith('SELECT preferences')) return { rows: [{ preferences: { market: 'US' } }], rowCount: 1 };
    if (sql === 'SELECT 1 FROM users LIMIT 1') return { rows: [{}], rowCount: 1 };
    if (sql.includes('s.csrf FROM sessions')) return { rows: [{ ...existingOwner, csrf: 'session-csrf' }], rowCount: 1 };
    throw new Error('Unexpected test SQL');
  });
  const context = { db: { query } as unknown as AppContext['db'], origin, dataRoot: 'unused-fixture', masterKey: '', setupKey: '', singleUserMode: true, ...overrides };
  const app = Fastify(); applications.push(app);
  await app.register(cookie);
  await registerAuth(app, context);
  app.post('/api/probe', async request => ({ id: request.user.id }));
  return { app, query, disableOwner: () => { enabledOwner = false; } };
}

describe('existing local desktop owner preference', () => {
  it('requires an explicit boolean preference, single-user mode and the exact desktop origin', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'workbench-owner-mode-')); folders.push(folder);
    expect(await readLocalOwnerMode(folder, true, origin)).toBe(false);
    for (const content of ['not JSON', 'null', '[]', '{}', '{"localOwnerMode":"true"}', '{"localOwnerMode":false}']) {
      await writeFile(path.join(folder, 'desktop-preferences.json'), content);
      expect(await readLocalOwnerMode(folder, true, origin)).toBe(false);
    }
    await writeFile(path.join(folder, 'desktop-preferences.json'), '{"localOwnerMode":true}');
    expect(await readLocalOwnerMode(folder, true, origin)).toBe(true);
    expect(await readLocalOwnerMode(folder, false, origin)).toBe(false);
    for (const other of ['http://localhost:4178', 'http://127.0.0.1:4179', 'http://127.0.0.1:4178/', 'https://example.com']) {
      expect(await readLocalOwnerMode(folder, true, other)).toBe(false);
    }
  });

  it('retains the existing active admin identity and preferences without creating or changing accounts', async () => {
    const { app, query } = await fixture({ localOwnerMode: true });
    expect((await app.inject({ url: '/api/auth/state' })).json()).toEqual({ needsSetup: false, hasSession: true });
    const me = await app.inject({ url: '/api/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: existingOwner, csrf: '', preferences: { market: 'US' } });
    expect((await app.inject({ method: 'POST', url: '/api/probe', headers: { origin } })).json()).toEqual({ id: existingOwner.id });
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(true);
  });

  it.each([{}, { localOwnerMode: false }, { localOwnerMode: true, singleUserMode: false }, { localOwnerMode: true, origin: 'http://localhost:4178' }])('keeps regular session authentication when mode constraints are absent: %j', async overrides => {
    const { app, query } = await fixture(overrides);
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/state' })).json()).toEqual({ needsSetup: false, hasSession: false });
    expect(query.mock.calls.every(([sql]) => !sql.includes("role='admin' AND active=true"))).toBe(true);
  });

  it('falls back to session authentication immediately when the active owner is absent or disabled', async () => {
    const { app, query, disableOwner } = await fixture({ localOwnerMode: true });
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(200);
    disableOwner();
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/state' })).json()).toEqual({ needsSetup: false, hasSession: false });
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(true);
  });

  it('rejects cross-origin or missing-origin writes before resolving a local owner', async () => {
    const { app, query } = await fixture({ localOwnerMode: true });
    for (const headers of [{}, { origin: 'https://example.com' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/probe', headers })).statusCode).toBe(403);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves CSRF enforcement for normal session-authenticated requests', async () => {
    const { app } = await fixture();
    const headers = { origin, cookie: 'vsw_session=synthetic-session' };
    expect((await app.inject({ method: 'POST', url: '/api/probe', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/probe', headers: { ...headers, 'x-csrf-token': 'session-csrf' } })).statusCode).toBe(200);
  });
});
