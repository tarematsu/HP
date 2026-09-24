import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./pages-response-cache-hit-benchmark.test.js', import.meta.url), 'utf8');

test('Pages benchmark regression threshold remains below one millisecond in Node', () => {
  assert.match(source, /milliseconds_per_invocation < 1/);
});
