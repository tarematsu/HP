import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('edge cache maximum age remains capped independently of materialized age', () => {
  assert.match(source, /DEFAULT_EDGE_CACHE_MAX_AGE_MS = 60 \* 1000/);
  assert.match(source, /Math\.min\(Math\.max\(0, Number\(materializedMaximumAge\) \|\| 0\), edgeMaximumAge\)/);
});
