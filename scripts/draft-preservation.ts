import assert from 'node:assert/strict';

interface TableDigest { count: number; hash: string; }
interface DraftAudit {
  passed: boolean; baselineHash: string; preservedSubsetHash: string; currentTableHash: string;
  preservedOriginalDrafts: number; currentDraftCount: number; additions: { id: string }[];
  originalDraftsChanged: number; originalDraftsDeleted: number;
  restoredOnlyToIsolatedDatabase: boolean; productionReadOnly: boolean;
}

/** A changed table needs snapshot-bound, per-record proof; never exempt all drafts. */
export function verifyPreservedDrafts(before: TableDigest, after: TableDigest, audit?: DraftAudit) {
  if (before.count === after.count && before.hash === after.hash) return 0;
  assert.ok(audit?.passed && audit.productionReadOnly && audit.restoredOnlyToIsolatedDatabase, '需要隔离备份与正式只读逐条审计');
  assert.equal(audit.baselineHash, before.hash);
  assert.equal(audit.preservedSubsetHash, before.hash);
  assert.equal(audit.currentTableHash, after.hash);
  assert.equal(audit.preservedOriginalDrafts, before.count);
  assert.equal(audit.currentDraftCount, after.count);
  assert.equal(audit.originalDraftsChanged, 0);
  assert.equal(audit.originalDraftsDeleted, 0);
  const additions = after.count - before.count;
  assert.ok(additions > 0, '不能把删除或修改当作新增');
  assert.equal(audit.additions.length, additions);
  assert.equal(new Set(audit.additions.map(row => row.id)).size, additions);
  return additions;
}
