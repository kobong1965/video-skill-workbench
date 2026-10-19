import { expect, it, vi } from 'vitest';
import { runWorkerLoop } from '../../apps/worker/pool';
import type { AppContext } from '../../apps/api/context';
import type { Job } from '../../apps/worker/queue';

const context = {} as AppContext;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const job = (id: string) => ({ id }) as Job;

it('一个worker同时执行两个已领取步骤，停止后不再领取且等待现有请求保存完', async () => {
  const pending = [job('one'), job('two'), job('three')];
  const gates = [deferred(), deferred()];
  const started: string[] = [];
  let stopping = false, ended = false;
  const claim = vi.fn(async () => pending.shift() ?? null);
  const work = runWorkerLoop(context, {
    stopping: () => stopping, idleMs: 5, limit: async () => 2, recover: async () => {}, claim,
    run: async (_context, item) => { const index = started.length; started.push(item.id); await gates[index].promise; },
  }).then(() => { ended = true; });
  await vi.waitFor(() => expect(started).toEqual(['one', 'two']));
  expect(claim).toHaveBeenCalledTimes(2);
  stopping = true;
  gates[0].resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(ended).toBe(false);
  expect(claim).toHaveBeenCalledTimes(2);
  gates[1].resolve(); await work;
  expect(ended).toBe(true);
  expect(pending.map(item => item.id)).toEqual(['three']);
});

it('单个步骤意外失败不结束并发循环，其他步骤可以继续并完整退出', async () => {
  const pending = [job('failed'), job('success')];
  const errors: unknown[] = [];
  let stopping = false;
  const work = runWorkerLoop(context, {
    stopping: () => stopping, idleMs: 5, limit: async () => 2, recover: async () => {},
    claim: async () => pending.shift() ?? null,
    run: async (_context, item) => { if (item.id === 'failed') throw new Error('isolated failure'); stopping = true; },
    onError: error => { errors.push(error); },
  });
  await work;
  expect(errors).toHaveLength(1);
  expect(pending).toHaveLength(0);
});
