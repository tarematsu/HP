import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('256-character R2 model key remains accepted', () => {
  assert.notEqual(pagesActionsR2ResponseKey('x'.repeat(256)), null);
});
