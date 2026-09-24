import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('R2 binding without get is treated as unavailable', async () => {
  assert.equal(await loadMaterializedR2Response({}, 'history:daily'), null);
  assert.equal(await loadMaterializedR2Response({}, 'track-history'), null);
});
