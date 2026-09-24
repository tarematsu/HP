import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('numeric R2 model key is normalized as text', () => {
  assert.equal(pagesR2ResponseKey(123), 'pages-response/v1/123.json');
});
