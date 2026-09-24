import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('R2 model key remains trimmed before encoding', () => {
  assert.equal(pagesActionsR2ResponseKey(' current '), pagesActionsR2ResponseKey('current'));
});
