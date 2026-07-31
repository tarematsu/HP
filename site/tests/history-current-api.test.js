import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCurrentMinuteSummary } from '../functions/api/history-current.js';

const NOW = Date.UTC(2026, 6, 30, 1, 23, 45);

function dailyDatabase(assertions) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_observed_id/);
      assert.match(sql, /WHERE f\.observed_at>=\? AND f\.observed_at<\?/);
      assert.doesNotMatch(sql, /FROM sh_channel_snapshots/);
      return {
        bind(start, end, limit) {
          assertions({ start, end, limit });
          return {
            async all() {
              return {
                results: [{
                  period_key: '2026-07-30',
                  period_start: start + 10_000,
                  period_end: end - 10_000,
                  sample_count: 1238,
                  reliable_sample_count: 1238,
                  listener_avg: 116.9,
                  listener_min: 89,
                  listener_max: 144,
                  stream_start: 10,
                  stream_end: 20,
                  member_start: 100,
                  member_end: 110,
                  primary_host: 'buddies',
                }],
              };
            },
          };
        },
      };
    },
  };
}

test('current daily summary scans only the complete UTC day in MINUTE_DB', async () => {
  let bindings;
  const summary = await loadCurrentMinuteSummary({
    MINUTE_DB: dailyDatabase((value) => { bindings = value; }),
  }, 'daily', NOW);

  assert.deepEqual(bindings, {
    start: Date.UTC(2026, 6, 30),
    end: NOW + 1,
    limit: 2,
  });
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].period_key, '2026-07-30');
  assert.equal(summary.rows[0].sample_count, 1238);
  assert.equal(summary.rows[0].stream_growth, null);
  assert.equal(summary.rows[0].member_growth, null);
  assert.match(summary.rows[0].quality_flags, /minute_facts/);
  assert.match(summary.rows[0].quality_flags, /incomplete_current_period/);
  assert.equal(summary.live_source, 'minute_facts');
  assert.equal(summary.storage_source, 'minute.sh_minute_facts');
  assert.equal(summary.read_path, 'minute-current-daily');
  assert.equal(summary.live_overlay_count, 1);
});

for (const mode of ['weekly', 'monthly']) {
  test(`${mode} is rejected before any database read`, async () => {
    let reads = 0;
    await assert.rejects(
      loadCurrentMinuteSummary({
        MINUTE_DB: { prepare() { reads += 1; throw new Error('must not run'); } },
      }, mode, NOW),
      new RegExp(`unsupported summary mode: ${mode}`),
    );
    assert.equal(reads, 0);
  });
}

test('current daily summary requires MINUTE_DB and never falls through to OTHER_DB', async () => {
  await assert.rejects(
    loadCurrentMinuteSummary({ OTHER_DB: { prepare() { throw new Error('must not run'); } } }, 'daily', NOW),
    /MINUTE_DB binding missing/,
  );
});
