import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('Worker R2 key encoding remains URL-safe', () => {
  assert.equal(pagesR2ResponseKey('曲'), 'pages-response/v1/%E6%9B%B2.json');
});
