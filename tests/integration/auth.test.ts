import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../packages/storage/database';
import { buildApp } from '../../apps/api/app';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { harness } from '../helpers';

let h: Awaited<ReturnType<typeof harness>>;
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let invite: string;
let secondCookie: string;
let secondId: string;
const origin = 'http://127.0.0.1:4178';
beforeAll(async () => {
  h = await harness('auth'); app = h.app;
});
afterAll(async () => { await h.close(); });
describe('邀请登录与服务端权限', () => {
  it('首次建站需要本机安装码，不能公开抢注管理员', async () => {
    const body = { username: 'owner', displayName: '主理人', password: 'test-password-2026' };
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { origin }, payload: { ...body, setupKey: 'wrong' } })).statusCode).toBe(403);
    const response = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { origin }, payload: { ...body, setupKey: 'local-setup-key' } });
    expect(response.statusCode).toBe(200);
    cookie = response.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    csrf = response.json().csrf;
    expect(response.json().user.username).toBe('owner');
  });
  it('拒绝无会话与跨站修改', async () => {
    expect((await app.inject('/api/me')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/admin/invitations', headers: { cookie, origin: 'https://evil.test', 'x-csrf-token': csrf }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/invitations', headers: { cookie, origin }, payload: {} })).statusCode).toBe(403);
  });
  it('管理员可生成单次邀请码', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/invitations', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { days: 7 } });
    expect(response.statusCode).toBe(200);
    invite = response.json().token;
  });
  it('邀请码只能成功使用一次', async () => {
    const body = { username: 'friend', displayName: '朋友', password: 'friend-password-2026', token: invite };
    const response = await app.inject({ method: 'POST', url: '/api/auth/join', headers: { origin }, payload: body });
    expect(response.statusCode).toBe(200);
    secondCookie = response.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    secondId = response.json().user.id;
    expect((await app.inject({ method: 'POST', url: '/api/auth/join', headers: { origin }, payload: { ...body, username: 'third' } })).statusCode).toBe(400);
  });
  it('普通账号不可读取管理接口，停用即时阻断已有会话', async () => {
    expect((await app.inject({ url: '/api/admin/users', headers: { cookie: secondCookie } })).statusCode).toBe(403);
    const changed = await app.inject({ method: 'PATCH', url: `/api/admin/users/${secondId}`, headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { active: false } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/me', headers: { cookie: secondCookie } })).statusCode).toBe(401);
  });
});
