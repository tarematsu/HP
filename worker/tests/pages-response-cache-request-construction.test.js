import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('serving implementation does not construct a cache-key Request', () => {
  const constructions = source.match(/new Request\(/g) || [];
  assert.equal(constructions.length, 0);
});
