import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('Pages serving CPU contract keeps edge cache first and allocation-free keying', () => {
  assert.match(source, /const cacheKey = dependencies\.cacheKey \? dependencies\.cacheKey\(request\) : request;/);
  assert.match(source, /const edgeResponse = await loadEdgeCachedResponse\(cache, cacheKey, now, edgeMaximumAge\);/);
  assert.match(source, /if \(edgeResponse\) return edgeResponse;/);
});
