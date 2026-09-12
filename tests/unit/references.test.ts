import { it, expect } from 'vitest';
import { batchMediaIds, validateReferences } from '../../packages/domain/references';
import type { TaskSnapshot, Shot } from '../../packages/contracts';
const snapshot = { media: [{ id: 'a', role: 'product' }, { id: 'b', role: 'detail' }, { id: 'c', role: 'comparison' }] } as TaskSnapshot;
it('逐批只选该批明确引用，空引用才回退同款商品图', () => {
  expect([...batchMediaIds(snapshot, [{ references: ['a'] } as Shot])]).toEqual(['a']);
  expect([...batchMediaIds(snapshot, [{ references: ['b'] } as Shot])]).toEqual(['b']);
  expect([...batchMediaIds(snapshot, [{ references: [] } as unknown as Shot])]).toEqual(['a', 'b']);
});
it('不能注入其他账号或不存在的素材 ID', () => {
  expect(() => validateReferences([{ references: ['other-user-media'] } as Shot], ['a', 'b'])).toThrow('不存在');
});
