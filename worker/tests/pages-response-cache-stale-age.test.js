import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('stale fallback maximum age remains seven days by default', () => {
  assert.match(source, /DEFAULT_STALE_FALLBACK_MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
});
