import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TaskSnapshot, TaskSummary } from '../../packages/contracts';
import { harness } from '../helpers';

let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let other: typeof owner;
const snapshot = { input: {}, skills: [], media: [] } as unknown as TaskSnapshot;
beforeAll(async () => {
  h = await harness('task_canvas_status');
  owner = await h.account(); other = await h.account();
});
afterAll(async () => h.close());

async function task(account = owner) {
  const id = randomUUID();
  await h.db.query("INSERT INTO tasks(id,owner_id,name,snapshot,status,created_at) VALUES($1,$2,'画布状态测试',$3,'completed','2026-10-18T00:00:00Z')", [id, account.id, snapshot]);
  return id;
}
async function result(taskId: string, number = 1) {
  const id = randomUUID();
  await h.db.query("INSERT INTO results(id,task_id,number,output,created_at) VALUES($1,$2,$3,$4,'2026-10-18T01:00:00Z')", [id, taskId, number, {}]);
  return id;
}
async function upload(taskId: string, resultId: string, status: string, time = '2026-10-19T01:00:00Z', account = owner) {
  const id = randomUUID();
  await h.db.query(`INSERT INTO canvas_imports(id,owner_id,task_id,result_id,submit_key,status,project_id,plan,steps,error,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [id, account.id, taskId, resultId, randomUUID(), status, `project-${id}`, { sensitivePrompt: 'private-plan-marker' }, JSON.stringify([{ key: 'private-steps-marker' }]), 'private-error-marker', time]);
  return id;
}
async function listed(url = '/api/task-board', account = owner) {
  const response = await h.app.inject({ url, headers: account.headers });
  expect(response.statusCode).toBe(200);
  return response.json() as TaskSummary[];
}

describe('任务栏和记录接口的画布上传状态（只读派生）', () => {
  it('两个列表都按最新结果派生状态，任务更新时间包含上传，不返回画布详细数据', async () => {
    const id = await task(); const first = await result(id);
    expect((await listed()).find(row => row.id === id)).toMatchObject({ status: 'completed', canvasUpload: { status: 'not_uploaded', previouslyUploaded: false } });
    const success = await upload(id, first, 'succeeded');
    for (const url of ['/api/task-board', '/api/tasks']) {
      const rows = await listed(url); const item = rows.find(row => row.id === id)!;
      expect(item).toMatchObject({ status: 'completed', canvasUpload: { status: 'uploaded', resultId: first, importId: success, previouslyUploaded: false } });
      expect(Date.parse(item.updatedAt)).toBeGreaterThanOrEqual(Date.parse('2026-10-19T01:00:00Z'));
      expect(JSON.stringify(item)).not.toMatch(/private-plan-marker|private-steps-marker|private-error-marker|submit_key/);
    }
    const latest = await result(id, 2);
    expect((await listed()).find(row => row.id === id)).toMatchObject({ latestResultId: latest, canvasUpload: { status: 'not_uploaded', resultId: latest, previouslyUploaded: true } });
    await upload(id, latest, 'unknown');
    const active = await upload(id, latest, 'queued');
    expect((await listed()).find(row => row.id === id)?.canvasUpload).toMatchObject({ status: 'uploading', importId: active, previouslyUploaded: true });
    await h.db.query("UPDATE canvas_imports SET status='succeeded',updated_at='2026-10-19T02:00:00Z' WHERE id=$1", [active]);
    await upload(id, latest, 'failed', '2026-10-19T03:00:00Z');
    const item = (await listed()).find(row => row.id === id)!;
    expect(item.canvasUpload).toMatchObject({ status: 'uploaded', importId: active, previouslyUploaded: true });
    expect(Date.parse(item.updatedAt)).toBe(Date.parse('2026-10-19T03:00:00Z'));
  });

  it('失败与中断不会写成已上传，按最后更新记录选择，并且读取不会修改上传记录', async () => {
    const id = await task(); const current = await result(id);
    const failed = await upload(id, current, 'failed');
    expect((await listed()).find(row => row.id === id)?.canvasUpload).toMatchObject({ status: 'failed', importId: failed });
    const unknown = await upload(id, current, 'unknown', '2026-10-19T02:00:00Z');
    const before = (await h.db.query('SELECT * FROM canvas_imports WHERE task_id=$1 ORDER BY id', [id])).rows;
    expect((await listed()).find(row => row.id === id)?.canvasUpload).toMatchObject({ status: 'unknown', importId: unknown });
    expect((await h.db.query('SELECT * FROM canvas_imports WHERE task_id=$1 ORDER BY id', [id])).rows).toEqual(before);
  });

  it('严格隔离owner、task和result，异常交叉关联的上传记录不会改变当前账号状态', async () => {
    const own = await task(); const ownResult = await result(own);
    const second = await task(); const secondResult = await result(second);
    const foreign = await task(other); const foreignResult = await result(foreign);
    await upload(own, ownResult, 'succeeded', undefined, other);
    await upload(own, secondResult, 'succeeded');
    await upload(own, foreignResult, 'succeeded');
    await upload(foreign, foreignResult, 'succeeded', undefined, other);
    const rows = await listed();
    expect(rows.find(row => row.id === own)?.canvasUpload).toMatchObject({ status: 'not_uploaded', previouslyUploaded: false });
    expect(rows.some(row => row.id === foreign)).toBe(false);
    expect((await listed('/api/tasks', other)).find(row => row.id === foreign)?.canvasUpload).toMatchObject({ status: 'uploaded' });
  });

  it('多个任务的列表使用一条批量画布查询，不逐卡片读取或返回计划内容', async () => {
    for (let i = 0; i < 5; i++) { const id = await task(); await upload(id, await result(id), 'succeeded'); }
    const query = vi.spyOn(h.db, 'query');
    try {
      await listed();
      const canvasQueries = query.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('canvas_imports'));
      expect(canvasQueries).toHaveLength(1);
      expect(canvasQueries[0][0]).not.toMatch(/SELECT\s+\*|\bc\.plan\b|\bc\.steps\b/);
    } finally { query.mockRestore(); }
  });
});
