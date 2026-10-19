import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createDatabase, migrate } from '../packages/storage/database';
import { buildApp } from '../apps/api/app';
import { digest, passwordHash } from '../apps/api/auth';

export async function harness(name: string, origin = 'http://127.0.0.1:4178', singleUserMode = false) {
  const schema = `vsw_${name}_${randomUUID().replaceAll('-', '')}`;
  const base = createDatabase(process.env.VSW_DATABASE_URL!);
  await base.query(`CREATE SCHEMA "${schema}"`); await base.end();
  const url = new URL(process.env.VSW_DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = createDatabase(url.toString()); await migrate(db);
  const context = { db, dataRoot: path.join(process.env.VSW_TEST_ROOT!, schema), masterKey: 'a'.repeat(64), setupKey: 'local-setup-key', origin, testMode: false, singleUserMode };
  const app = await buildApp(context);
  async function account(role: 'admin' | 'member' = 'member') {
    const id = randomUUID(); const token = randomUUID(); const csrf = randomUUID();
    await db.query('INSERT INTO users(id,username,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)', [id, id, '测试用户', await passwordHash('test-password-2026'), role]);
    await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [digest(token), id, csrf]);
    return { id, role, headers: { cookie: `vsw_session=${token}`, origin: context.origin, 'x-csrf-token': csrf } };
  }
  return { app, db, context, account, close: async () => { await app.close(); await db.end(); } };
}
