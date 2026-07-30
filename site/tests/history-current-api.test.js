import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCurrentMinuteSummary } from '../functions/api/history-current.js';

const NOW = Date.UTC(2026, 6, 30, 1, 23, 45);

function databaseFor(periodKey, assertions) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_channel_snapshots WHERE observed_at>=\? AND observed_at<\?/);
      return {
        bind(start, end, limit) {
          assertions({ start, end, limit });
          return {
            async all() {
              return {
                results: [{
                  period_key: periodKey,
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

for (const [mode, periodKey, expectedStart] of [
  ['daily', '2026-07-30', Date.UTC(2026, 6, 30)],
  ['weekly', '2026-07-27', Date.UTC(2026, 6, 27)],
  ['monthly', '2026-07', Date.UTC(2026, 6, 1)],
]) {
  test(`current ${mode} summary scans the complete current period in MINUTE_DB`, async () => {
    let bindings;
    const summary = await loadCurrentMinuteSummary({
      MINUTE_DB: databaseFor(periodKey, (value) => { bindings = value; }),
    }, mode, NOW);

    assert.deepEqual(bindings, { start: expectedStart, end: NOW + 1, limit: 2 });
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.rows[0].period_key, periodKey);
    assert.equal(summary.rows[0].sample_count, 1238);
    assert.equal(summary.rows[0].stream_growth, null);
    assert.equal(summary.rows[0].member_growth, null);
    assert.match(summary.rows[0].quality_flags, /minute_facts/);
    assert.match(summary.rows[0].quality_flags, /incomplete_current_period/);
    assert.equal(summary.live_source, 'minute_facts');
    assert.equal(summary.storage_source, 'minute.sh_channel_snapshots');
    assert.equal(summary.live_overlay_count, 1);
  });
}

test('current summary requires MINUTE_DB and never falls through to OTHER_DB', async () => {
  await assert.rejects(
    loadCurrentMinuteSummary({ OTHER_DB: { prepare() { throw new Error('must not run'); } } }, 'daily', NOW),
    /MINUTE_DB binding missing/,
  );
});
