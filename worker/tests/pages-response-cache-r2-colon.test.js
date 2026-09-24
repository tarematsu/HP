import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('Worker R2 key retains encoded model separator', () => {
  assert.equal(pagesR2ResponseKey('history:daily'), 'pages-response/v1/history%3Adaily.json');
});
