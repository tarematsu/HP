import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('cache lookup precedes all storage adapter selection', () => {
  const hit = source.indexOf('loadEdgeCachedResponse(cache, cacheKey');
  for (const marker of ['R2_ONLY_MODEL_KEYS.has(modelKey)', 'modelKey === TRACK_HISTORY_MODEL_KEY']) {
    assert.equal(hit < source.indexOf(marker), true, marker);
  }
});
