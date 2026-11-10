const userDirectories = /^(?:skills?|skill-library|materials|ui-source|ui-customizations|backend-import|data|pgdata|postgres-data|desktop-profile|user-data|user-exports?|exports|backups?|private-datasets?|datasets?|user-media|media|uploads?|product-images|product-sets|production)$/i;
const privateFiles = /^(?:local-secrets\.json|postgres-local\.json|credentials\.json|secrets\.json|本机安装码\.txt|id_rsa|id_ed25519)$/i;
const privateExtensions = /\.(?:sqlite(?:3)?|db|dump|backup|bak|p12|pfx|key|zip|7z|rar|tar|tgz|gz|mp4|mov|mkv|avi|webm|m4v|wmv|mpeg|mpg|mts)$/i;

/** Paths inside a software package or source snapshot, never the outer program ZIP. */
export function validateSoftwareReleasePaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of paths) {
    const normalized = value.replaceAll('\\', '/');
    const parts = normalized.split('/');
    if (!value || /[:\x00-\x1f]/.test(value) || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
      throw new Error('软件发布只允许安全的包内相对路径');
    }
    const dependency = parts.findIndex(part => part.toLowerCase() === 'node_modules');
    // These are the application's editor and upload UI source directories.
    // Limit the exception to their exact locations and source file types.
    const sourceUiIndex = /^(?:server\/)?apps\/web\/src\/(?:skills|uploads)\/.+\.(?:tsx?|css)$/i.test(normalized)
      ? (parts[0].toLowerCase() === 'server' ? 4 : 3) : -1;
    for (const [index, part] of parts.entries()) {
      // Dependency names and implementation folders may legitimately mention skills,
      // media or data. Application/user folders are checked before that boundary.
      const insideDependency = dependency >= 0 && index > dependency;
      if (/^(?:SKILL\.md|\.env(?:\..*)?|\.git|\.cache|\.vite(?:-temp)?)$/i.test(part)
        || privateFiles.test(part)
        || (!insideDependency && ((index !== sourceUiIndex && userDirectories.test(part)) || /^catalog\.json$/i.test(part) || /-data$/i.test(part)))) {
        throw new Error(`软件发布不能包含用户资料或 Skill：${normalized}`);
      }
    }
    const filename = parts.at(-1)!;
    if (privateExtensions.test(filename) || /^(?:private[-_]?key)(?:\..*)?$/i.test(filename)
      || /^(?:Cookies|Login Data)(?:-journal|-wal|-shm)?$/i.test(filename)) {
      throw new Error(`软件发布不能包含资料、密钥、数据库或压缩合集：${normalized}`);
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) throw new Error(`软件发布存在重复路径：${normalized}`);
    seen.add(key);
  }
}

/** Reject missing declarations as well as a manifest that contradicts them. */
export function validateSoftwareReleaseManifest(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('缺少软件发行清单');
  const manifest = value as Record<string, unknown>;
  if (manifest.includesUserData !== false || manifest.includesSkills !== false) {
    throw new Error('软件发行清单必须明确 includesUserData:false 和 includesSkills:false');
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('软件发行清单必须列出程序文件');
  const paths = manifest.files.map((file: unknown) => {
    if (!file || typeof file !== 'object' || typeof (file as Record<string, unknown>).path !== 'string') {
      throw new Error('软件发行清单包含无效文件路径');
    }
    return (file as { path: string }).path;
  });
  validateSoftwareReleasePaths(paths);
}
