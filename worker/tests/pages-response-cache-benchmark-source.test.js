import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/benchmark-pages-response-cache-hit.mjs', import.meta.url), 'utf8');

test('Pages benchmark measures warm edge-cache hit path', () => {
  assert.match(source, /for \(let i = 0; i < 1000/);
  assert.match(source, /const iterations = 10000/);
  assert.match(source, /milliseconds_per_invocation/);
});
