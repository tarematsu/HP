import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('Pages response serving keeps cache lookup ahead of storage', () => {
  const cacheIndex = source.indexOf('loadEdgeCachedResponse(cache, cacheKey');
  const r2Index = source.indexOf('loadR2(env?.PAGES_RESPONSE_R2');
  assert.equal(cacheIndex >= 0, true);
  assert.equal(r2Index >= 0, true);
  assert.equal(cacheIndex < r2Index, true);
});

test('default cache key does not allocate a replacement Request', () => {
  assert.match(source, /dependencies\.cacheKey \? dependencies\.cacheKey\(request\) : request/);
  assert.doesNotMatch(source, /function edgeCacheKey/);
});
