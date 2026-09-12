import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { transaction } from '../../packages/storage/database';
import { AppError, admin, type AppContext } from './context';
import type { User } from '../../packages/contracts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scryptAsync = promisify(scrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}
async function passwordMatches(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':');
  const actual = await scryptAsync(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const userSql = 'id, username, display_name AS "displayName", role, active';
const credentials = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,40}$/), password: z.string().min(10).max(200) });
const newUser = credentials.extend({ displayName: z.string().trim().min(1).max(50) });

export async function registerAuth(app: FastifyInstance, context: AppContext) {
  const { db, origin } = context;
  const publicPaths = new Set(['/api/health', '/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/auth/join']);
  app.decorateRequest('user');
  app.decorateRequest('csrf', '');
  app.addHook('onRequest', async request => {
    const pathname = request.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== origin) throw new AppError(403, '请求来源不符，请从工作台页面操作');
    if (publicPaths.has(pathname)) return;
    const token = request.cookies.vsw_session;
    if (!token) throw new AppError(401, '请先登录');
    const result = await db.query(`SELECT u.id, u.username, u.display_name AS "displayName", u.role, u.active, s.csrf FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [digest(token)]);
    if (!result.rows[0]) throw new AppError(401, '登录已过期或账号已停用');
    request.user = result.rows[0]; request.csrf = result.rows[0].csrf;
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-csrf-token'] !== request.csrf) throw new AppError(403, '页面验证已失效，请刷新后再试');
  });
  async function session(reply: FastifyReply, user: User) {
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')", [digest(token), user.id, csrf]);
    reply.setCookie('vsw_session', token, { path: '/', httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), maxAge: 604800 });
    return { user, csrf };
  }
  app.get('/api/auth/state', async request => ({ needsSetup: !(await db.query('SELECT 1 FROM users LIMIT 1')).rowCount,
    hasSession: request.cookies.vsw_session ? Boolean((await db.query('SELECT 1 FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true', [digest(request.cookies.vsw_session)])).rowCount) : false }));
  app.post('/api/auth/setup', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = newUser.extend({ setupKey: z.string() }).parse(request.body);
    if (!timingSafeEqual(Buffer.from(digest(input.setupKey)), Buffer.from(digest(context.setupKey)))) throw new AppError(403, '本机安装码不正确');
    const hash = await passwordHash(input.password);
    const user = await transaction(db, async client => {
      await client.query('SELECT pg_advisory_xact_lock(719340012)');
      if ((await client.query('SELECT 1 FROM users LIMIT 1')).rowCount) throw new AppError(409, '工作台已初始化，请登录');
      return (await client.query(`INSERT INTO users(id,username,display_name,password_hash,role) VALUES($1,$2,$3,$4,'admin') RETURNING ${userSql}`, [randomUUID(), input.username, input.displayName, hash])).rows[0] as User;
    });
    return session(reply, user);
  });
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = credentials.parse(request.body);
    const row = (await db.query(`SELECT ${userSql},password_hash FROM users WHERE username=$1`, [input.username])).rows[0];
    // Equalize the expensive operation for unknown and known usernames.
    const fallback = '0'.repeat(32) + ':' + '0'.repeat(128);
    const matched = await passwordMatches(input.password, row?.password_hash ?? fallback);
    if (!row || !matched || !row.active) throw new AppError(401, '账号或密码不正确，或账号已停用');
    const { password_hash: _, ...user } = row;
    return session(reply, user);
  });
  app.post('/api/auth/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = newUser.extend({ token: z.string().min(16).max(100) }).parse(request.body);
    const hash = await passwordHash(input.password);
    const user = await transaction(db, async client => {
      const invitation = (await client.query('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE', [digest(input.token)])).rows[0];
      if (!invitation || invitation.used_by || new Date(invitation.expires_at) < new Date()) throw new AppError(400, '邀请码无效、已使用或已过期');
      const user = (await client.query(`INSERT INTO users(id,username,display_name,password_hash,role) VALUES($1,$2,$3,$4,'member') RETURNING ${userSql}`, [randomUUID(), input.username, input.displayName, hash])).rows[0] as User;
      await client.query('UPDATE invitations SET used_by=$1 WHERE id=$2', [user.id, invitation.id]);
      return user;
    });
    return session(reply, user);
  });
  app.get('/api/me', async request => {
    const { csrf: _, ...user } = request.user as User & { csrf?: string };
    return { user, csrf: request.csrf, preferences: (await db.query('SELECT preferences FROM users WHERE id=$1', [user.id])).rows[0].preferences };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(request.cookies.vsw_session!)]);
    reply.clearCookie('vsw_session', { path: '/' }); return { ok: true };
  });
  app.put('/api/preferences', async request => {
    const value = z.object({ platform: z.enum(['douyin', 'tiktok']), market: z.enum(['CN', 'US', 'VN']), model: z.enum(['seedance-2.0', 'seedance-2.5']), category: z.string().max(50) }).parse(request.body);
    await db.query('UPDATE users SET preferences=$1 WHERE id=$2', [value, request.user.id]); return { ok: true };
  });
  app.post('/api/admin/invitations', async request => {
    admin(request); const { days } = z.object({ days: z.number().int().min(1).max(30).default(7) }).parse(request.body ?? {});
    const token = randomBytes(24).toString('hex');
    await db.query("INSERT INTO invitations(id,token_hash,creator_id,expires_at) VALUES($1,$2,$3,now()+make_interval(days=>$4))", [randomUUID(), digest(token), request.user.id, days]);
    return { token, days };
  });
  app.get('/api/admin/users', async request => { admin(request); return (await db.query(`SELECT ${userSql} FROM users ORDER BY created_at`)).rows; });
  app.patch('/api/admin/users/:id', async request => {
    admin(request); const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { active } = z.object({ active: z.boolean() }).parse(request.body);
    if (id === request.user.id && !active) throw new AppError(400, '不能停用自己的账号');
    await transaction(db, async client => {
      await client.query('UPDATE users SET active=$1 WHERE id=$2', [active, id]);
      if (!active) await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await client.query('INSERT INTO audit(user_id,action,resource_id) VALUES($1,$2,$3)', [request.user.id, active ? 'user.enabled' : 'user.disabled', id]);
    });
    return { ok: true };
  });
}
