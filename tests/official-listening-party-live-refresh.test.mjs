import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('official listening party live refresh stays uncached and frequent', () => {
  const status = readFileSync(new URL('../site/functions/api/sakurazaka46jp-status.js', import.meta.url), 'utf8');
  assert.match(status, /cache-control': 'no-store'/);
});
