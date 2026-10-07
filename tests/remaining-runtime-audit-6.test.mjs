import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cachedHostSummary,
  resetHostSummaryCache,
} from '../site/functions/api/host-history.js';

test('host summary cache coalesces concurrent D1 reads per binding', async () => {
  resetHostSummaryCache();
  let reads = 0;
  const db = {
    prepare() {
      return {
        async all() {
          reads += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {
            results: [
              { result_kind: 1, id: 2, handle: 'sakurazaka46jp', status: 'active' },
              { result_kind: 2, id: 2, handle: 'sakurazaka46jp', status: 'active' },
              { result_kind: 2, id: 1, handle: 'sakurazaka46jp', status: 'ended' },
            ],
          };
        },
      };
    },
  };

  const [first, second] = await Promise.all([
    cachedHostSummary(db),
    cachedHostSummary(db),
  ]);
  assert.strictEqual(first, second);
  assert.equal(reads, 1);
  assert.strictEqual(await cachedHostSummary(db), first);
  assert.equal(reads, 1);
});
