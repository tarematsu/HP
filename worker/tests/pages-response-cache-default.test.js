import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('Pages serving retains global default Cache API fallback', () => {
  assert.match(source, /dependencies\.cache \|\| globalThis\.caches\?\.default \|\| null/);
});
