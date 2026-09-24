import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('Actions R2 freshness is checked before Response construction', () => {
  const fresh = source.indexOf('if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;');
  const response = source.indexOf("headers.set('x-api-source', 'actions-r2')");
  assert.equal(fresh >= 0 && response > fresh, true);
});
