import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedLiveSummaryStart,
  currentSummaryPeriodStart,
  liveSummaryFallbackStart,
  loadSummaryWithLive,
} from '../functions/lib/history-summary.js';

const NOW = Date.UTC(2026, 6, 19, 12, 34, 56);
const DAY_MS = 86_400_000;

function summaryDb(calls) {
  return {
    prepare(sql) {
      calls.push(sql);
      const statement = {
        bind() { return statement; },
        async all() { return { results: [] }; },
      };
      return statement;
    },
  };
}

test('live summary periods use UTC boundaries', () => {
  assert.equal(currentSummaryPeriodStart('daily', NOW), Date.UTC(2026, 6, 19));
  assert.equal(currentSummaryPeriodStart('weekly', NOW), Date.UTC(2026, 6, 13));
  assert.equal(currentSummaryPeriodStart('monthly', NOW), Date.UTC(2026, 6, 1));
});

test('missing or stale rollups reopen only a bounded recent raw tail', () => {
  const oldStart = Date.UTC(2024, 5, 1);
  assert.equal(liveSummaryFallbackStart('daily', NOW), Date.UTC(2026, 6, 18));
  assert.equal(liveSummaryFallbackStart('weekly', NOW), Date.UTC(2026, 5, 29));
  assert.equal(liveSummaryFallbackStart('monthly', NOW), Date.UTC(2026, 4, 1));
  assert.equal(
    boundedLiveSummaryStart('daily', oldStart, null, NOW),
    Date.UTC(2026, 6, 18),
  );
  assert.equal(
    boundedLiveSummaryStart('weekly', oldStart, Date.UTC(2025, 11, 31), NOW),
    Date.UTC(2026, 5, 29),
  );
  assert.equal(
    boundedLiveSummaryStart('monthly', oldStart, Date.UTC(2026, 3, 30), NOW),
    Date.UTC(2026, 4, 1),
  );
});

test('a newer completed rollup boundary still wins over the fallback floor', () => {
  const from = Date.UTC(2026, 6, 1);
  const lastBaseEnd = Date.UTC(2026, 6, 19, 6);
  assert.equal(
    boundedLiveSummaryStart('daily', from, lastBaseEnd, NOW),
    lastBaseEnd + 1,
  );
});

test('public history reads persisted summaries without touching raw snapshot databases', async () => {
  const calls = [];
  const forbidden = {
    prepare() {
      assert.fail('public history must not query DB or MINUTE_DB when no boundary evidence is required');
    },
  };
  for (const mode of ['daily', 'weekly', 'monthly']) {
    const result = await loadSummaryWithLive({
      OTHER_DB: summaryDb(calls),
      DB: forbidden,
      MINUTE_DB: forbidden,
    }, mode, '2024-06-01', '2026-07-19', NOW);
    assert.equal(result.live_overlay_count, 0, mode);
    assert.equal(result.live_source, 'summary-only', mode);
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every((sql) => /FROM sh_(?:daily|weekly|monthly)_summary/.test(sql)));
  assert.ok(calls.every((sql) => !/sh_channel_snapshots|sh_minute_facts/.test(sql)));
});

test('completed boundary evidence is persisted while daily member values stay canonical', async () => {
  const key = '2026-07-18';
  const expectedStart = Date.UTC(2026, 6, 18);
  const expectedEnd = expectedStart + DAY_MS;
  const stored = {
    period_key: key,
    period_start: expectedStart + 2 * 60 * 60_000,
    period_end: expectedEnd - 2 * 60 * 60_000,
    sample_count: 1440,
    reliable_sample_count: 1440,
    listener_avg: 20,
    listener_min: 10,
    listener_max: 30,
    stream_start: 110,
    stream_end: 140,
    stream_growth: 30,
    member_start: 200,
    member_end: 205,
    member_growth: 5,
    likes_max: null,
    distinct_tracks: 12,
    primary_host: 'host',
    quality_score: 1,
    quality_flags: '[]',
  };
  let updateBindings = null;
  const otherDb = {
    prepare(sql) {
      if (/^\s*SELECT\b/i.test(sql)) {
        return {
          bind() {
            return { all: async () => ({ results: [stored] }) };
          },
        };
      }
      assert.match(sql, /UPDATE sh_daily_summary SET/);
      return {
        bind(...bindings) {
          updateBindings = bindings;
          return { run: async () => ({ success: true }) };
        },
      };
    },
  };
  const evidenceDb = {
    prepare(sql) {
      assert.match(sql, /sh_period_boundary_evidence/);
      return {
        bind() {
          return {
            all: async () => ({ results: [{
              period_key: key,
              boundary_start_at: expectedStart + 60_000,
              boundary_end_at: expectedEnd - 60_000,
              stream_start: 100,
              stream_end: 150,
              member_start: 999,
              member_end: 999,
              has_start: 1,
              has_end: 1,
            }] }),
          };
        },
      };
    },
  };

  const result = await loadSummaryWithLive({
    OTHER_DB: otherDb,
    DB: evidenceDb,
    MINUTE_DB: evidenceDb,
  }, 'daily', key, key, NOW);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].period_start, expectedStart + 60_000);
  assert.equal(result.rows[0].period_end, expectedEnd - 60_000);
  assert.equal(result.rows[0].stream_start, 100);
  assert.equal(result.rows[0].stream_end, 150);
  assert.equal(result.rows[0].stream_growth, 50);
  assert.equal(result.rows[0].member_start, 200);
  assert.equal(result.rows[0].member_end, 205);
  assert.equal(result.rows[0].member_growth, 5);
  assert.deepEqual(updateBindings, [
    expectedStart + 60_000,
    expectedEnd - 60_000,
    100,
    150,
    50,
    200,
    205,
    5,
    NOW,
    key,
  ]);
});
