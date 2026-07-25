import assert from 'node:assert/strict';
import test from 'node:test';

import { filterBlockedItems } from '../src/video-blocklist.js';

test('empty and missing blocklist input performs no D1 setup or query', async () => {
  let prepares = 0;
  let batches = 0;
  const db = {
    prepare() {
      prepares += 1;
      return {};
    },
    async batch() {
      batches += 1;
      return [];
    }
  };

  assert.deepEqual(await filterBlockedItems(db, []), { items: [], blockedCount: 0 });
  assert.deepEqual(await filterBlockedItems(db, undefined), { items: [], blockedCount: 0 });
  assert.equal(prepares, 0);
  assert.equal(batches, 0);
});
