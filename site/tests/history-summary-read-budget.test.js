import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedLiveSummaryStart,
  currentSummaryPeriodStart,
  liveSummaryFallbackStart,
  loadSummaryWithLive,
} from '../functions/lib/history-summary.js';

const NOW = Date.UTC(2026, 6, 19, 12, 34, 56);

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
