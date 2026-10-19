import type { AppContext } from '../api/context';
import { getExecutionSettings } from '../../packages/providers/config';
import { claimJob, recoverExpiredJobs, runJob, type Job } from './queue';

export interface WorkerLoopOptions {
  stopping: () => boolean;
  onError?: (error: unknown) => void;
  idleMs?: number;
  claim?: (context: AppContext) => Promise<Job | null>;
  run?: (context: AppContext, job: Job) => Promise<void>;
  recover?: (context: AppContext) => Promise<void>;
  limit?: (context: AppContext) => Promise<number>;
}
export async function runWorkerLoop(context: AppContext, options: WorkerLoopOptions) {
  const active = new Set<Promise<void>>();
  const idleMs = options.idleMs ?? 1000;
  const report = options.onError ?? (() => {});
  const claim = options.claim ?? claimJob;
  const execute = options.run ?? runJob;
  const recover = options.recover ?? recoverExpiredJobs;
  const limit = options.limit ?? (async () => (await getExecutionSettings(context)).maxConcurrentJobs);
  let nextRecovery = 0;
  try {
    while (!options.stopping()) {
      try {
        if (Date.now() >= nextRecovery) {
          await recover(context);
          nextRecovery = Date.now() + idleMs;
        }
        const maximum = Math.max(1, Math.min(32, await limit(context)));
        while (!options.stopping() && active.size < maximum) {
          const job = await claim(context);
          if (!job) break;
          // Start every claimed job promptly. Claiming reserves its real DB slot;
          // do not create a second in-memory queue with expiring unused leases.
          const execution = Promise.resolve().then(() => execute(context, job)).catch(report).finally(() => active.delete(execution));
          active.add(execution);
        }
      } catch (error) { report(error); }
      if (!options.stopping()) {
        // Sleep is bounded even when an upstream request intentionally has no
        // timeout, so configuration changes and stop signals remain observable.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([...active, new Promise<void>(resolve => { timer = setTimeout(resolve, idleMs); })]); }
        finally { clearTimeout(timer); }
      }
    }
  } finally {
    // A stop prevents new claims; already dispatched jobs retain their heartbeat
    // and can save results before the caller closes the database.
    await Promise.allSettled(active);
  }
}
