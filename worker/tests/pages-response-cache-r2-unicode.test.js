import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('Actions R2 key encoding remains UTF-8 deterministic', () => {
  assert.equal(pagesActionsR2ResponseKey('曲'), 'pages-response/actions-v2/e69bb2.json');
});
