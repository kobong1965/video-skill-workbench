import path from 'node:path';
import { createBackup } from '../packages/storage/backup';
import { localPostgres } from './postgres';

const data = process.env.VSW_DATA_ROOT!;
const index = process.argv.indexOf('--backup-root');
if (index < 0 || !process.argv[index + 1]) throw new Error('请通过 --backup-root 指定 E:/Codex工作盘 下尚不存在的完整备份目录');
const database = process.env.VSW_DATABASE_URL ? null : await localPostgres(path.join(data, 'postgres'), 15479);
try {
  const saved = await createBackup(process.env.VSW_DATABASE_URL || database!.url, data, process.argv[index + 1]);
  console.log(`已保存本机备份：${saved.directory}。包含密钥和私人资料，请勿公开。`);
} finally { await database?.stop(); }
