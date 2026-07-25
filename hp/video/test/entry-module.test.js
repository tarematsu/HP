import assert from 'node:assert/strict';
import test from 'node:test';

import entry from '../src/entry.js';

test('deployed entry exposes fetch and scheduled handlers', () => {
  assert.equal(typeof entry.fetch, 'function');
  assert.equal(typeof entry.scheduled, 'function');
});
