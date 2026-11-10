import { execFileSync } from 'node:child_process';
import { validateSoftwareReleasePaths } from './software-release-safety';

// Check Git's actual next source snapshot, not only .gitignore patterns.
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
validateSoftwareReleasePaths(paths);
console.log(`Software-only source boundary passed: ${paths.length} tracked files; no Skill library or user media.`);
