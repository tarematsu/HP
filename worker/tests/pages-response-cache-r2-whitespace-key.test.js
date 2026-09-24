import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey, pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('whitespace-only R2 model key remains rejected', () => {
  assert.equal(pagesActionsR2ResponseKey('   '), null);
  assert.equal(pagesR2ResponseKey('   '), null);
});
