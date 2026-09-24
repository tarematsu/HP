import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('missing R2 binding returns null without work', async () => {
  assert.equal(await loadMaterializedR2Response(null, 'history:daily'), null);
});
