import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('numeric Actions R2 model key is normalized as text', () => {
  assert.equal(pagesActionsR2ResponseKey(1), 'pages-response/actions-v2/31.json');
});
