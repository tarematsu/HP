import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./pages-response-cache-hit-benchmark.test.js', import.meta.url), 'utf8');

test('Pages benchmark regression test executes the benchmark script with Node', () => {
  assert.match(source, /execFileSync\(process\.execPath/);
  assert.match(source, /benchmark-pages-response-cache-hit\.mjs/);
});
