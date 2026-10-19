import { expect, it } from 'vitest';
import { verifyPreservedDrafts } from '../../scripts/draft-preservation';

const before = { count: 20, hash: 'original-drafts' };
const after = { count: 21, hash: 'with-new-draft' };
const proof = { passed: true, baselineHash: before.hash, preservedSubsetHash: before.hash, currentTableHash: after.hash, preservedOriginalDrafts: 20, currentDraftCount: 21, additions: [{ id: 'new-draft' }], originalDraftsChanged: 0, originalDraftsDeleted: 0, restoredOnlyToIsolatedDatabase: true, productionReadOnly: true };

it('完全不变的草稿摘要无需额外审计', () => {
  expect(verifyPreservedDrafts(before, before)).toBe(0);
});

it('仅接受隔离备份逐条验证过的新增草稿', () => {
  expect(verifyPreservedDrafts(before, after, proof)).toBe(1);
});

it('没有旧草稿逐条证明不能豁免整表变化', () => {
  expect(() => verifyPreservedDrafts(before, after)).toThrow();
});

it('旧草稿修改、删除、审计基线或计数不符均拒绝', () => {
  for (const patch of [{ originalDraftsChanged: 1 }, { originalDraftsDeleted: 1 }, { preservedSubsetHash: 'changed' }, { baselineHash: 'wrong-backup' }, { currentTableHash: 'stale' }, { currentDraftCount: 22 }, { preservedOriginalDrafts: 19 }, { productionReadOnly: false }, { passed: false }, { additions: [] }]) {
    expect(() => verifyPreservedDrafts(before, after, { ...proof, ...patch })).toThrow();
  }
  expect(() => verifyPreservedDrafts(before, { count: 19, hash: 'deleted' }, proof)).toThrow();
});
