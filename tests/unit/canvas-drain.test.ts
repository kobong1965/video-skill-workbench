import { describe, expect, it, vi } from 'vitest';
import { CanvasImportRunner } from '../../packages/canvas/import-service';
import type { AppContext } from '../../apps/api/context';
import type { CanvasCli } from '../../packages/canvas/cli';

describe('画布正常关闭排空', () => {
  it('等待已接受的运行和排队任务，不abort、不改为unknown、关闭后不接新任务', async () => {
    const query = vi.fn(); const runner = new CanvasImportRunner({ db: { query } } as unknown as AppContext, {} as CanvasCli);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const run = vi.spyOn(runner as unknown as { run(id: string): Promise<void> }, 'run').mockImplementation(async id => { if (id === 'first') await gate; });
    runner.enqueue('first'); runner.enqueue('second');
    await Promise.resolve(); expect(run).toHaveBeenCalledWith('first');
    let closed = false; const done = runner.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    expect(() => runner.enqueue('third')).toThrow('关闭');
    release(); await done;
    expect(run.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
    expect(query).not.toHaveBeenCalled();
  });
});
