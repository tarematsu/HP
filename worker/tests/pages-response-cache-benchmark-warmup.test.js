import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/benchmark-pages-response-cache-hit.mjs', import.meta.url), 'utf8');

test('Pages benchmark warms the dynamic module and Response path', () => {
  const warm = source.indexOf('i < 1000');
  const start = source.indexOf('const started = performance.now()');
  assert.equal(warm >= 0 && warm < start, true);
});
