import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('cache-key preparation does not clone the request', () => {
  const keyLine = source.match(/const cacheKey = .*;/)?.[0] || '';
  assert.equal(keyLine.includes('new Request'), false);
  assert.equal(keyLine.includes('request.clone'), false);
});
