import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const workspace = path.resolve('E:/Codex工作盘');
const tempBase = path.join(workspace, 'temp/video-skill-workbench');
const buildsBase = path.join(workspace, 'artifacts/test-builds/video-skill-workbench');
const inside = (target: string, parent: string) => target.toLowerCase().startsWith(parent.toLowerCase() + path.sep);

/** Intentionally no defaults: this entry must never select an installed data root. */
export function previewOptions(args: string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--root', '--web-root', '--port'].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error('请显式指定 --root、--web-root 和 --port');
    values.set(args[i], args[i + 1]);
  }
  if (values.size !== 3) throw new Error('请显式指定 --root、--web-root 和 --port');
  const rootValue = values.get('--root')!; const webValue = values.get('--web-root')!;
  const root = path.resolve(rootValue); const webRoot = path.resolve(webValue); const port = Number(values.get('--port'));
  if (!path.isAbsolute(rootValue) || !inside(root, tempBase)) throw new Error('预览数据只能写入工作盘独立临时目录');
  if (!path.isAbsolute(webValue) || !inside(webRoot, buildsBase)) throw new Error('预览只能使用工作盘测试构建');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('请显式指定有效的本机端口');
  return { root, webRoot, port };
}

export function blockedPreviewRequest(_method: string, url: string) {
  const pathname = decodeURIComponent(url.split('?')[0]);
  return /^\/api\/(?:canvas|libtv)(?:\/|$)/.test(pathname)
    || /^\/api\/tasks\/[^/]+\/(?:canvas-imports|generate|images)(?:\/|$)/.test(pathname)
    || /^\/api\/jobs\/[^/]+\/retry(?:\/|$)/.test(pathname)
    || /^\/api\/admin\/providers(?:\/|$)/.test(pathname);
}

async function assertPhysicalRoot(target: string, base: string) {
  let existing = target;
  for (;;) {
    try { const resolved = await realpath(existing); if (resolved.toLowerCase() !== base.toLowerCase() && !inside(resolved, base)) throw new Error('预览路径不能通过链接指向其他目录'); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existing); if (parent === existing) throw error; existing = parent;
    }
  }
}

export async function startPreview(args: string[]) {
  const { root, webRoot, port } = previewOptions(args);
  await assertPhysicalRoot(root, tempBase); await assertPhysicalRoot(webRoot, buildsBase);
  await stat(path.join(webRoot, 'index.html'));
  const sessionRoot = path.join(root, randomUUID()); await mkdir(sessionRoot, { recursive: true });
  // No dotenv/config load; the only database is the new local preview cluster.
  for (const key of Object.keys(process.env)) if (key.startsWith('VSW_')) delete process.env[key];
  Object.assign(process.env, { TEMP: sessionRoot, TMP: sessionRoot, TMPDIR: sessionRoot,
    XDG_CACHE_HOME: path.join(sessionRoot, 'cache'), VSW_TEST_ROOT: sessionRoot, VSW_TEST_INIT_NOSYNC: '1',
    VSW_PG_PACKAGE: path.join(workspace, 'runtimes/video-skill-workbench/node_modules/@embedded-postgres/windows-x64/dist/index.js') });
  const { localPostgres } = await import('./postgres');
  const database = await localPostgres(path.join(sessionRoot, 'postgres'));
  let h: Awaited<ReturnType<typeof import('../tests/helpers').harness>> | undefined;
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); try { await h?.close(); } finally { await database.stop(); } };
  const interrupt = () => { void stop().then(() => process.exit(0)).catch(() => process.exit(1)); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    process.env.VSW_DATABASE_URL = database.url;
    const { harness } = await import('../tests/helpers');
    const { saveMedia } = await import('../packages/storage/private-files');
    const { default: fastifyStatic } = await import('@fastify/static');
    const { default: sharp } = await import('sharp');
    h = await harness('soft_preview', `http://127.0.0.1:${port}`, true); h.context.testMode = true;
    h.app.addHook('onRequest', async (request, reply) => {
      if (blockedPreviewRequest(request.method, request.url)) return reply.code(403).send({ error: '这是隔离 UI 预览，不连接 AI 接口或 LibTV 画布' });
    });
    await h.app.register(fastifyStatic, { root: webRoot });
    const user = await h.account('admin');
    await h.db.query("UPDATE users SET username='preview-admin',display_name='界面预览' WHERE id=$1", [user.id]);
    const post = async <T>(url: string, payload: unknown): Promise<T> => {
      const reply = await h!.app.inject({ method: 'POST', url, headers: user.headers, payload: payload as object });
      if (reply.statusCode >= 400) throw new Error(`预览样例初始化失败：${url} (${reply.statusCode})`);
      return reply.json() as T;
    };
    const names = ['客厅穿搭', '车库深蹲', '雪地换装', '停车场上衣', '面料近景', '衣架发现', '开门叠衣', '镜前自拍', '三秒惊讶', '仓储挂裤', '日常叠穿', '同款对比'];
    const colors = ['#4c628a', '#777a57', '#a18f7b', '#526d5e', '#a06870', '#667b8f', '#6c5e80', '#94745d', '#54686c', '#788298', '#aa8277', '#766f62'];
    const skills: { id: string; versionId: string }[] = []; const products: string[] = [];
    for (const [index, name] of names.entries()) {
      // Code-drawn textile placeholder, never presented as a generated person or real product.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#f1eee9"/><stop offset="1" stop-color="#d7dde7"/></linearGradient><linearGradient id="c" x2="1" y2="1"><stop stop-color="${colors[index]}"/><stop offset="1" stop-color="#252b38"/></linearGradient></defs><rect width="480" height="640" rx="24" fill="url(#b)"/><ellipse cx="240" cy="570" rx="145" ry="18" fill="#263144" opacity=".12"/><path d="M150 115L330 115L355 545L255 545L240 310L222 545L122 545Z" fill="url(#c)"/><path d="M150 137L330 137M240 137V300M164 150L175 205L218 205M316 150L305 205L262 205" fill="none" stroke="#e6e1d9" stroke-opacity=".45" stroke-width="3"/><rect x="218" y="117" width="44" height="20" rx="5" fill="#bdac92"/><text x="240" y="65" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#667185">UI PREVIEW / ${String(index + 1).padStart(2, '0')}</text><text x="240" y="615" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#667185">ILLUSTRATION ONLY</text></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const media = await saveMedia(h.context, user.id, `界面示例-${index + 1}.png`, png); products.push(media.id);
      const skill = await post<{ id: string; versionId: string }>('/api/skills', { name: `${name} · 示例`, tags: ['UI示例', index % 2 ? '穿搭' : '展示'], kind: 'full', duration: 15, text: `# ${name} · UI 预览样例\n此脚本仅用于界面演示，不是已验证的带货 Skill。\n三镜头：整体展示、细节展示、完整穿搭。`, source: '本地 UI 示例', visibility: 'private' });
      await post(`/api/skills/${skill.id}/preview`, { mediaId: media.id }); skills.push(skill);
    }
    for (let index = 0; index < 3; index++) {
      const skill = skills[index]; const mediaId = products[index];
      const setMedia: { id: string; role: 'product' | 'detail' }[] = [{ id: mediaId, role: 'product' }];
      const sample = await readFile(path.join(h.context.dataRoot, 'media', mediaId));
      for (let number = 2; number <= 6; number++) {
        const saved = await saveMedia(h.context, user.id, `图套${index + 1}-示意图${number}.png`, sample);
        setMedia.push({ id: saved.id, role: 'detail' });
      }
      const productSet = await post<{ id: string; styleNumber: string }>('/api/product-sets', { styleNumber: `DEMO-${5007 + index}`, name: `六图示例 · ${index + 1}（非真实商品）`, media: setMedia });
      const task = await post<{ id: string }>('/api/tasks', { name: `${names[index]} · 预览`, productName: '示例裤装', productSetId: productSet.id, styleNumber: productSet.styleNumber, media: [{ id: mediaId, role: 'product' }], platform: 'tiktok', market: 'US', category: '服装', targetDuration: 15, model: 'seedance-2.5', generatePerson: false, generateScene: false, voice: 'none', selections: [{ ...skill, duration: 15 }] });
      await post(`/api/tasks/${task.id}/results`, { output: { productFacts: [{ text: '示例为代码绘制服装插图，仅用于界面预览。', source: 'provided' }], unknowns: ['真实成分、尺码、售价均未提供'], conflicts: [], globalPrompt: '【本地 UI 示例，非 AI 生成结果】9:16 竖屏，三个镜头直接硬切。保持产品外观、人物与光线连续；不添加未证实的产品卖点。', shots: ['整体展示', '细节展示', '穿搭展示'].map((title, shotIndex) => ({ skillVersionId: skill.versionId, duration: 5, title, prompt: `【界面示例】第 ${shotIndex + 1} 镜采用${title}，保持当前产品颜色及结构一致。画面自然，不夸张变形。`, dialogue: '', translation: '', storyAudio: '低音量无词器乐，无广告配音。', startState: '产品位于画面中央', endState: '自然停留后硬切', references: [mediaId] })), assetPlan: [] } });
    }
    await h.app.listen({ host: '127.0.0.1', port });
    console.log(`UI 预览：http://127.0.0.1:${port}`);
    console.log('示例账号：preview-admin / test-password-2026（不连接 AI 或画布；Ctrl+C 停止）');
    return { stop };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startPreview(process.argv.slice(2)).catch(error => { console.error('UI 预览启动失败：', (error as Error).message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[本地数据库地址]')); process.exitCode = 1; });
}
