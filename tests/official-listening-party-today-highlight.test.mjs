import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('today official listening party line is emphasized', () => {
  const source = readFileSync(new URL('../site/public/history/history-broadcasts.js', import.meta.url), 'utf8');
  assert.match(source, /Asia\/Tokyo/);
  assert.match(source, /isTodayEvent/);
  assert.match(source, /today \? 3\.4/);
  assert.match(source, /today \? 1 : \(available\.length > 12 \? 0\.68 : 0\.9\)/);
});
