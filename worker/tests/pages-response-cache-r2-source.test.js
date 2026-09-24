import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('R2 serving retains source headers', () => {
  assert.match(source, /headers\.set\('x-api-source', 'actions-r2'\)/);
  assert.match(source, /headers\.set\('x-api-source', 'worker-r2'\)/);
});
