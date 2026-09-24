import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('Worker R2 key remains deterministic', () => {
  assert.equal(pagesR2ResponseKey('track-history'), 'pages-response/v1/track-history.json');
});
