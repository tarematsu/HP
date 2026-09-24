import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('storage failure diagnostic retains model key', () => {
  assert.match(source, /pages_response_storage_read_failed/);
  assert.match(source, /model_key: modelKey/);
});
