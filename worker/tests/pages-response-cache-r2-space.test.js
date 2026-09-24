import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('Worker R2 key trims surrounding whitespace', () => {
  assert.equal(pagesR2ResponseKey(' current '), 'pages-response/v1/current.json');
});
