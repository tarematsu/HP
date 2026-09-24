import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./pages-response-cache-hit-benchmark.test.js', import.meta.url), 'utf8');

test('Pages benchmark regression threshold does not branch on CI', () => {
  assert.doesNotMatch(source, /\bCI\b/);
});
