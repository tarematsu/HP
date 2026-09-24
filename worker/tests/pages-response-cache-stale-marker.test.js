import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('stale materialized response remains explicitly marked', () => {
  assert.match(source, /headers\.set\('x-materialized-stale', '1'\)/);
});
