import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('cache failures retain bounded diagnostics', () => {
  assert.match(source, /pages_response_edge_cache_read_failed/);
  assert.match(source, /pages_response_edge_cache_write_failed/);
  assert.match(source, /slice\(0, 300\)/);
});
