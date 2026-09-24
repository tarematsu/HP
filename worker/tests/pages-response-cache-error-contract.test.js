import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('Pages serving keeps closed 404 and 503 responses no-store', () => {
  assert.match(source, /status: 404[\s\S]*'cache-control': 'no-store'/);
  assert.match(source, /status: 503[\s\S]*'cache-control': 'no-store'/);
});
