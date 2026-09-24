import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey, pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('invalid R2 model keys remain rejected', () => {
  assert.equal(pagesActionsR2ResponseKey(''), null);
  assert.equal(pagesR2ResponseKey(''), null);
  assert.equal(pagesActionsR2ResponseKey('x'.repeat(257)), null);
});
