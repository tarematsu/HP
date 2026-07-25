import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_REPAIR_CANDIDATES,
  MAX_REPAIR_ENQUEUES,
  MINUTE_FACT_REPAIR_END,
  MINUTE_FACT_REPAIR_KEY,
  MINUTE_FACT_REPAIR_PRIORITY,
  MINUTE_FACT_REPAIR_START,
} from '../src/minute-facts-repair.js';

const source = readFileSync(new URL('../src/minute-facts-repair.js', import.meta.url), 'utf8');

test('July repair window is the four JST days and uses a higher source priority', () => {
  assert.equal(MINUTE_FACT_REPAIR_KEY, 'total-listener-20260710-13-v1');
  assert.equal(MINUTE_FACT_REPAIR_PRIORITY, 110);
  assert.equal(MINUTE_FACT_REPAIR_START, Date.UTC(2026, 6, 9, 15));
  assert.equal(MINUTE_FACT_REPAIR_END, Date.UTC(2026, 6, 13, 15));
});

test('repair matches both the original equality corruption and the old flagged-null form', () => {
  assert.match(source, /reported_current_stream_count=\$\{alias\}reported_total_listens/);
  assert.match(source, /reported_current_stream_count IS NULL/);
  assert.match(source, /quality_flags & 64/);
  assert.match(source, /source-fingerprint-mismatch/);
});

test('repair burst raises candidate and enqueue ceilings to one Queue batch', () => {
  assert.equal(MAX_REPAIR_CANDIDATES, 100);
  assert.equal(MAX_REPAIR_ENQUEUES, 100);
  assert.match(source, /MINUTE_FACT_REPAIR_CANDIDATE_LIMIT/);
  assert.match(source, /MINUTE_FACT_REPAIR_ENQUEUE_LIMIT/);
});

test('repair is idempotent and protects changed facts from overwrite', () => {
  assert.match(source, /INSERT OR IGNORE INTO sh_minute_fact_repairs/);
  assert.match(source, /currentMatchesOriginal/);
  assert.match(source, /fact-fingerprint-changed/);
  assert.match(source, /expected_source_record_id/);
  assert.match(source, /forceRepair: true/);
});
