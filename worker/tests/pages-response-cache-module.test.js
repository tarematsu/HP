import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('storage modules remain lazily loaded after cache lookup', () => {
  const cacheHit = source.indexOf('if (edgeResponse) return edgeResponse;');
  const r2Load = source.indexOf('await loadResponseR2Module()');
  const kvLoad = source.indexOf('await loadResponseStoreModule()');
  assert.equal(cacheHit < r2Load, true);
  assert.equal(cacheHit < kvLoad, true);
});
