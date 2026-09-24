import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('Actions R2 key hex-encodes model separator', () => {
  assert.equal(pagesActionsR2ResponseKey('a:b'), 'pages-response/actions-v2/613a62.json');
});
