import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const canvasTempRoot = 'E:/Codex工作盘/temp/video-skill-workbench/canvas';
export interface CanvasCli { execute(args: string[], signal?: AbortSignal): Promise<unknown>; }

export function assertImportCommand(args: string[]) {
  if (args.some(x => x === '-r' || x === '--run' || x.startsWith('--run='))) throw new Error('画布导入不允许触发生成');
  const [command, operation] = args;
  const allowed = command === '--version' || command === 'upload'
    || (command === 'model' && Boolean(operation) && operation !== 'search')
    || (command === 'account' && ['info', 'list'].includes(operation))
    || (command === 'workspace' && operation === 'list')
    || (command === 'project' && (['list', 'create'].includes(operation) || /^[a-zA-Z0-9-]{16,64}$/.test(operation)))
    || (command === 'group' && Boolean(operation) && !['use', 'unuse', 'delete'].includes(operation))
    || (command === 'node' && Boolean(operation));
  if (!allowed || (command === 'node' && ['delete', 'use', 'unuse'].includes(operation))) throw new Error('不支持的画布导入操作');
}

export function canvasError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/((?:token|api[_-]?key|authorization|cookie)[=:]\s*)[^\s&]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]').slice(0, 1200);
}

export class LibTVClient implements CanvasCli {
  private executable?: string;
  async locate() {
    if (this.executable) return this.executable;
    const candidates = [path.resolve('runtime/libtv.exe'), process.env.LIBTV_CLI_PATH, path.join(homedir(), '.libtv', process.platform === 'win32' ? 'libtv.exe' : 'libtv')].filter((x): x is string => Boolean(x));
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate)) continue;
      try { await access(candidate); this.executable = candidate; return candidate; } catch { /* try next known location */ }
    }
    throw new Error('未找到 LibTV 官方 CLI，请在管理设置中配置已安装的 CLI');
  }
  async execute(args: string[], signal?: AbortSignal): Promise<unknown> {
    assertImportCommand(args);
    const executable = await this.locate();
    await mkdir(canvasTempRoot, { recursive: true });
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: canvasTempRoot, shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'], signal,
        env: { ...process.env, TEMP: canvasTempRoot, TMP: canvasTempRoot, TMPDIR: canvasTempRoot } });
      let stdout = ''; let stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) child.kill(); });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-12000); });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) return reject(new Error(canvasError(stderr.trim() || `LibTV 操作失败（${code}）`)));
        if (args[0] === '--version') return resolve(stdout.trim());
        try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error('LibTV 未返回有效的工作流结果')); }
      });
    });
  }
}
