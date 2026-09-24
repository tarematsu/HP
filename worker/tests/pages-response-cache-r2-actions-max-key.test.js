import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('Actions R2 model key length boundary remains enforced', () => {
  assert.notEqual(pagesActionsR2ResponseKey('x'.repeat(256)), null);
  assert.equal(pagesActionsR2ResponseKey('x'.repeat(257)), null);
});
