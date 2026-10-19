import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!['apps/api/main.ts', 'apps/worker/main.ts'].includes(entry)) throw new Error('不支持的后台入口');
let requested = false; let forwarded = false;
function forwardShutdown() {
  if (!requested || forwarded || process.listenerCount('SIGTERM') === 0) return;
  forwarded = true;
  process.emit('SIGTERM');
}
// Handle shutdown even while runtimeContext/startup awaits I/O. Forward only after
// the real entry has installed its handler, so an early close never kills work.
process.on('newListener', event => { if (event === 'SIGTERM' && requested) setImmediate(forwardShutdown); });
process.on('message', message => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'vsw:shutdown') {
    requested = true; forwardShutdown();
  }
});
await import(pathToFileURL(path.resolve(entry)).href);
forwardShutdown();
// Worker top-level await returns only after its in-flight job and DB pool finish.
// API exits itself after app.close() has drained its accepted requests and canvas.
if (entry === 'apps/worker/main.ts' && process.connected) process.disconnect?.();
