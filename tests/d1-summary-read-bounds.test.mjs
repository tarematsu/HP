import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../site/functions/lib/current-minute-summary.js';

test('current daily summary reads the incremental one-row projection', () => {
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /FROM sh_current_daily_summary AS p/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /p\.day_at=\?1/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_minute_facts_live_minute/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_total_member_daily_latest/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /prepared AS MATERIALIZED/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /ROW_NUMBER\(\) OVER/);
});
