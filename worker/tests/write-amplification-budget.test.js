import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dailyState = readFileSync(new URL('../src/minute-facts-daily-state.js', import.meta.url), 'utf8');
const statementPlan = readFileSync(new URL('../src/minute-facts-statement-plan.js', import.meta.url), 'utf8');
const legacyRevision = readFileSync(
  new URL('../src/minute-facts-legacy-revision.js', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../database/facts-migrations/039_reduce_fact_write_amplification.sql', import.meta.url),
  'utf8',
);

const MINUTES_PER_DAY = 24 * 60;
const FIVE_MINUTE_BUCKETS_PER_DAY = MINUTES_PER_DAY / 5;
const COUNTER_CHANGES_PER_HOUR = 9;
const PLAYBACK_OBSERVATIONS_PER_HOUR = 16;
const PLAYBACK_HEARTBEATS_PER_HOUR = 3;

test('steady-state write reductions cover the measured daily overage', () => {
  assert.doesNotMatch(dailyState, /CHECKPOINT/);
  assert.match(dailyState, /excluded\.last_total_member_count IS NOT/);
  assert.match(statementPlan, /Math\.floor\(minuteAt \/ DASHBOARD_BUCKET_MS\)/);
  assert.match(statementPlan, /ON CONFLICT\(channel_id,bucket_at\) DO UPDATE/);
  assert.match(migration, /idx_sh_minute_facts_source_minute_desc/);
  assert.match(migration, /idx_sh_minute_facts_total_listens_baseline/);
  assert.match(migration, /idx_sh_counter_changes_source/);
  assert.match(migration, /idx_sh_counter_changes_track_time/);
  assert.match(legacyRevision, /PLAYBACK_STATE_HEARTBEAT_MS = 20 \* 60_000/);
  assert.match(
    legacyRevision,
    /excluded\.last_observed_at-sh_playback_current\.last_observed_at>=\?/,
  );

  const savedDailyMemberWrites = MINUTES_PER_DAY - 1;
  const savedDuplicateIndexWrites = MINUTES_PER_DAY;
  const savedTotalListensIndexWrites = MINUTES_PER_DAY;
  const savedRollupWrites = MINUTES_PER_DAY - FIVE_MINUTE_BUCKETS_PER_DAY;
  const savedCounterIndexWrites = COUNTER_CHANGES_PER_HOUR * 24 * 2;
  const savedPlaybackHeartbeatWrites = (
    PLAYBACK_OBSERVATIONS_PER_HOUR - PLAYBACK_HEARTBEATS_PER_HOUR
  ) * 24;
  const projectedSavedWrites = savedDailyMemberWrites
    + savedDuplicateIndexWrites
    + savedTotalListensIndexWrites
    + savedRollupWrites
    + savedCounterIndexWrites
    + savedPlaybackHeartbeatWrites;

  assert.equal(projectedSavedWrites, 6_215);
  assert.ok(projectedSavedWrites > 5_027);
});
