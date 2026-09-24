import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('256-character Worker R2 model key remains accepted', () => {
  assert.notEqual(pagesR2ResponseKey('x'.repeat(256)), null);
  assert.equal(pagesR2ResponseKey('x'.repeat(257)), null);
});
