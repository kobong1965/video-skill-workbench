import { describe, expect, it } from 'vitest';
import { validateSoftwareReleaseManifest, validateSoftwareReleasePaths } from '../../scripts/software-release-safety';

describe('software-only release boundary', () => {
  it.each([
    'skills/example/SKILL.md', 'skill-library/example/readme.txt', 'materials/preview.png',
    'catalog.json', 'server/catalog.json', 'server/skills/example/workbench.json',
    'VideoSkillWorkbench-0.1.19-Windows-x64/server/skill-library/example.txt',
    'ui-source/screens/preview.png', 'server/ui-customizations/branding.json',
    'ui-customizations/backend-import/private.json', 'backend-import/catalog.json',
    'server/data/config.json', 'server/private-datasets/products.csv', 'datasets/products.csv',
    'server/user-exports/task.json', 'production/report.txt', 'media/product.png',
    'uploads/photo.jpg', 'server/product-images/photo.jpg', 'backups/snapshot.sql',
    'server/video-skill-workbench-data/settings.json', 'pgdata/PG_VERSION',
    'server/SKILL.md', 'server/Skill.md', 'server/.env.local', 'local-secrets.json',
    'server/postgres-local.json', 'credentials.json', 'secrets.json', 'desktop-profile/Cookies',
    'server/workbench.sqlite', 'server/workbench.sqlite3', 'server/workbench.db',
    'backup.dump', 'private-key.pem', 'id_ed25519', 'server/private.key',
    'reference.MP4', 'assets/original.mov', 'server/media.webm',
    'VideoSkillWorkbench-Script-Skills.zip', 'server/skill-export.7z',
    'server\\skill-library\\private.txt', 'server\\.ENV',
  ])('rejects user content in any software package: %s', filename => {
    expect(() => validateSoftwareReleasePaths([filename])).toThrow();
  });

  it('keeps application code, SQL migrations, branding and legal dependency names', () => {
    const paths = [
      'scripts/windows-package.ts', 'scripts/software-release-safety.ts', 'scripts/public-release-safety.ts',
      'apps/api/skills.ts', 'apps/api/product-catalog.ts', 'packages/domain/skill-import.ts',
      'server/database/migrations/002-skills.sql', 'tests/fixtures/upload-qa.tsx',
      'web/assets/index-abcd.js', 'desktop/branding/logo-source.png',
      '视频Skill工作台.exe', 'runtime/pg-client/bin/psql.exe',
      'server/node_modules/@example/skills/index.js',
      'server/node_modules/skill-library/lib/catalog.json',
      'server/node_modules/example/lib/data/index.js',
      'server/node_modules/undici/lib/web/cookies/index.js',
    ];
    expect(() => validateSoftwareReleasePaths(paths)).not.toThrow();
  });

  it('still rejects private files inside a dependency tree and user folders above it', () => {
    for (const filename of ['server/node_modules/example/SKILL.md', 'server/node_modules/example/.env', 'server/node_modules/example/test.mp4', 'skills/node_modules/example/index.js']) {
      expect(() => validateSoftwareReleasePaths([filename])).toThrow();
    }
  });

  it('allows only explicit editor and upload UI source directories, not user libraries', () => {
    expect(() => validateSoftwareReleasePaths([
      'apps/web/src/skills/ReferenceVideoNotice.tsx',
      'apps/web/src/skills/preview.ts',
      'apps/web/src/skills/editor.css',
      'server/apps/web/src/skills/ReferenceVideoNotice.tsx',
      'apps/web/src/uploads/FileDropzone.tsx',
      'apps/web/src/uploads/file-upload.ts',
      'server/apps/web/src/uploads/FileDropzone.tsx',
    ])).not.toThrow();
    for (const filename of ['skills/ReferenceVideoNotice.tsx', 'apps/api/skills/private.ts', 'other/apps/web/src/skills/preview.ts', 'apps/web/src/skills/SKILL.md', 'apps/web/src/skills/private.json', 'apps/web/src/skills/original.mp4', 'apps/web/src/skills/data/private.ts', 'uploads/file-upload.ts', 'apps/web/src/uploads/private.json', 'apps/web/src/uploads/photo.jpg', 'apps/web/src/uploads/skills/private.ts']) {
      expect(() => validateSoftwareReleasePaths([filename])).toThrow();
    }
  });

  it.each(['', '/outside/file', '\\outside\\file', 'E:/private.txt', 'file:secret', '../secret', 'server/../../secret', 'server//file', 'server/./file', 'server/skills./file', 'server/skills /file', 'server/file\0'])('rejects unsafe Windows and archive path aliases: %s', filename => {
    expect(() => validateSoftwareReleasePaths([filename])).toThrow();
  });

  it('rejects duplicate manifest entries across slash styles and case', () => {
    expect(() => validateSoftwareReleasePaths(['server/apps/api/main.ts', 'SERVER\\apps\\api\\MAIN.ts'])).toThrow('重复路径');
  });

  it('requires explicit declarations and validates the actual manifest file list', () => {
    const manifest = { includesUserData: false, includesSkills: false, files: [{ path: 'server/apps/api/main.ts', size: 12, sha256: '0'.repeat(64) }] };
    expect(() => validateSoftwareReleaseManifest(manifest)).not.toThrow();
    for (const invalid of [null, {}, { ...manifest, includesUserData: true }, { ...manifest, includesSkills: true }, { ...manifest, includesSkills: undefined }, { ...manifest, includesSkills: 'false' }, { ...manifest, files: [] }, { ...manifest, files: [null] }, { ...manifest, files: [{ path: 42 }] }, { ...manifest, files: [{ path: 'skills/private.txt' }] }]) {
      expect(() => validateSoftwareReleaseManifest(invalid)).toThrow();
    }
  });
});
