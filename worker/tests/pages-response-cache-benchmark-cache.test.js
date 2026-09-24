import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/benchmark-pages-response-cache-hit.mjs', import.meta.url), 'utf8');

test('Pages benchmark cache fixture always returns the warm response', () => {
  assert.match(source, /cache: \{ match: async \(\) => cached \}/);
});
