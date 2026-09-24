import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('only response cache fill requires a clone', () => {
  const clones = source.match(/\.clone\(\)/g) || [];
  assert.equal(clones.length, 1);
  assert.match(source, /cache\.put\(request, response\.clone\(\)\)/);
});
