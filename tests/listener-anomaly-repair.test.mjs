import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repair = readFileSync(new URL('../worker/scripts/repair-low-listener-anomalies.mjs', import.meta.url), 'utf8');
const reconcile = readFileSync(new URL('../worker/src/minute-facts-day-reconcile.js', import.meta.url), 'utf8');
const normalize = readFileSync(new URL('../worker/src/minute-facts-normalize.js', import.meta.url), 'utf8');

test('low-listener repair protects corrected minute facts from restore writes', () => {
  assert.match(repair, /LOW_LISTENER_MAX = 15/);
  assert.match(repair, /PROTECTED_REPAIR_PRIORITY = 200/);
  assert.match(repair, /source_priority=CASE WHEN COALESCE\(source_priority,0\)<\? THEN \? ELSE source_priority END/);
  assert.match(reconcile, /PROTECTED_CORRECTION_PRIORITY = 200/);
  assert.match(reconcile, /source_priority \|\| 0\) >= PROTECTED_CORRECTION_PRIORITY\) continue/);
  assert.match(normalize, /excluded\.source_priority>sh_minute_facts\.source_priority/);
});

test('low-listener repair interpolates only with nearby normal neighbours and otherwise excludes the sample', () => {
  assert.match(repair, /MAX_INTERPOLATION_DISTANCE_MS = 30 \* 60_000/);
  assert.match(repair, /current > LOW_LISTENER_MAX/);
  assert.match(repair, /method: 'interpolated'/);
  assert.match(repair, /value: null, method: 'excluded'/);
  assert.match(repair, /COUNT\(listener_count\) AS reliable_sample_count/);
  assert.match(repair, /MIN\(listener_count\) AS listener_min/);
});
