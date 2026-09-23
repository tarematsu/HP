import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DAILY_BOUNDARY_TOLERANCE_MS,
  MONTHLY_BOUNDARY_TOLERANCE_MS,
  WEEKLY_BOUNDARY_TOLERANCE_MS,
  applySummaryCompleteness,
  applyTrackPeriodCompleteness,
  currentPeriodKey,
  evaluatePeriodCompleteness,
  expectedPeriodBounds,
  periodBoundaryToleranceMs,
} from '../site/functions/lib/period-completeness.js';

const AFTER_JULY = Date.parse('2026-07-02T12:00:00Z');

function summaryRow(mode, periodKey, overrides = {}) {
  const bounds = expectedPeriodBounds(mode, periodKey);
  return {
    period_key: periodKey,
    period_start: bounds.start,
    period_end: bounds.end,
    stream_growth: 100,
    quality_flags: '[]',
    ...overrides,
  };
}

test('daily period uses UTC boundaries corresponding to 09:00 Japan', () => {
  const bounds = expectedPeriodBounds('daily', '2026-07-01');
  assert.equal(bounds.start, Date.parse('2026-07-01T00:00:00Z'));
  assert.equal(bounds.end, Date.parse('2026-07-02T00:00:00Z'));
  assert.equal(new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(bounds.start)), '2026-07-01 09:00');
});

test('daily keeps fifteen minutes while weekly/monthly use about five percent of the period', () => {
  assert.equal(periodBoundaryToleranceMs('daily'), DAILY_BOUNDARY_TOLERANCE_MS);
  assert.equal(periodBoundaryToleranceMs('weekly'), WEEKLY_BOUNDARY_TOLERANCE_MS);
  assert.equal(periodBoundaryToleranceMs('monthly'), MONTHLY_BOUNDARY_TOLERANCE_MS);
  assert.equal(DAILY_BOUNDARY_TOLERANCE_MS, 15 * 60 * 1000);
  assert.equal(WEEKLY_BOUNDARY_TOLERANCE_MS, 7 * 86400000 * 0.05);
  assert.equal(MONTHLY_BOUNDARY_TOLERANCE_MS, 30 * 86400000 * 0.05);
  assert.equal(periodBoundaryToleranceMs('monthly', '2026-05'), 31 * 86400000 * 0.05);
});

test('weekly accepts entrance and exit observations within five percent', () => {
  const bounds = expectedPeriodBounds('weekly', '2026-07-06');
  const tolerance = periodBoundaryToleranceMs('weekly', '2026-07-06');
  const result = evaluatePeriodCompleteness({
    mode: 'weekly',
    periodKey: '2026-07-06',
    firstObservedAt: bounds.start - tolerance,
    lastObservedAt: bounds.end + tolerance,
    now: bounds.end + tolerance + 1,
  });
  assert.equal(result.complete, true);
});

test('monthly accepts entrance and exit observations within five percent', () => {
  const bounds = expectedPeriodBounds('monthly', '2026-05');
  const tolerance = periodBoundaryToleranceMs('monthly', '2026-05');
  const result = evaluatePeriodCompleteness({
    mode: 'monthly',
    periodKey: '2026-05',
    firstObservedAt: bounds.start + tolerance,
    lastObservedAt: bounds.end - tolerance,
    now: bounds.end + tolerance + 1,
  });
  assert.equal(result.complete, true);
});

test('weekly and monthly reject evidence beyond five percent', () => {
  for (const [mode, periodKey] of [
    ['weekly', '2026-07-06'],
    ['monthly', '2026-05'],
  ]) {
    const bounds = expectedPeriodBounds(mode, periodKey);
    const tolerance = periodBoundaryToleranceMs(mode, periodKey);
    const result = evaluatePeriodCompleteness({
      mode,
      periodKey,
      firstObservedAt: bounds.start - tolerance - 1,
      lastObservedAt: bounds.end,
      now: bounds.end + tolerance + 1,
    });
    assert.ok(result.reasons.includes('missing_period_start'));
  }
});

test('completed daily period keeps stream and listener metrics', () => {
  const bounds = expectedPeriodBounds('daily', '2026-06-30');
  const result = applySummaryCompleteness([summaryRow('daily', '2026-06-30', {
    period_start: bounds.start + 5 * 60000,
    period_end: bounds.end - 5 * 60000,
    listener_avg: 123,
    listener_min: 100,
    listener_max: 150,
    stream_growth: 1234,
  })], 'daily', AFTER_JULY);
  assert.equal(result.excludedCount, 0);
  assert.equal(result.rows[0].listener_avg, 123);
  assert.equal(result.rows[0].listener_metrics_excluded, false);
  assert.equal(result.rows[0].stream_growth, 1234);
  assert.equal(result.rows[0].period_complete, true);
});

test('missing period entrance or exit keeps listener and stream metrics, but member growth still requires both member boundaries', () => {
  const bounds = expectedPeriodBounds('daily', '2026-06-30');
  const result = applySummaryCompleteness([summaryRow('daily', '2026-06-30', {
    period_start: bounds.start + 60 * 60000,
    period_end: bounds.end - 60 * 60000,
    listener_avg: 9999,
    listener_min: 9000,
    listener_max: 10000,
    stream_growth: 999,
    member_growth: 12,
  })], 'daily', AFTER_JULY);
  assert.equal(result.excludedCount, 0);
  assert.equal(result.rows[0].listener_avg, 9999);
  assert.equal(result.rows[0].listener_min, 9000);
  assert.equal(result.rows[0].listener_max, 10000);
  assert.equal(result.rows[0].listener_metrics_excluded, false);
  assert.equal(result.rows[0].stream_growth, 999);
  assert.equal(result.rows[0].stream_growth_excluded, false);
  assert.equal(result.rows[0].member_growth, null);
  assert.equal(result.rows[0].member_growth_excluded, true);
  assert.equal(result.rows[0].period_complete, false);
  assert.deepEqual(result.rows[0].exclusion_reasons, ['missing_period_start', 'missing_period_end']);
  assert.match(result.rows[0].quality_flags, /incomplete_period_start/);
  assert.match(result.rows[0].quality_flags, /incomplete_period_end/);
});

test('April 30 daily growth is excluded as a known collection gap', () => {
  const result = applySummaryCompleteness([
    summaryRow('daily', '2026-04-30', { stream_growth: 5000 }),
  ], 'daily', AFTER_JULY);
  assert.equal(result.rows[0].stream_growth, null);
  assert.deepEqual(result.rows[0].exclusion_reasons, ['known_collection_gap']);
});

test('current day, week, and month are excluded', () => {
  for (const [mode, periodKey] of [
    ['daily', '2026-07-02'],
    ['weekly', '2026-06-29'],
    ['monthly', '2026-07'],
  ]) {
    const result = applySummaryCompleteness([summaryRow(mode, periodKey, {
      period_end: AFTER_JULY,
      quality_flags: mode === 'weekly' ? '["stationhead_email_recap"]' : '[]',
    })], mode, AFTER_JULY);
    assert.equal(result.rows[0].stream_growth, null, `${mode} should be excluded`);
    assert.ok(result.rows[0].exclusion_reasons.includes('current_period'));
  }
  assert.equal(currentPeriodKey('daily', AFTER_JULY), '2026-07-02');
  assert.equal(currentPeriodKey('weekly', AFTER_JULY), '2026-06-29');
  assert.equal(currentPeriodKey('monthly', AFTER_JULY), '2026-07');
});

test('completed January through June email weekly records remain trusted', () => {
  const result = applySummaryCompleteness([{
    period_key: '2026-06-22',
    period_start: Date.parse('2026-06-22T10:00:00+09:00'),
    period_end: Date.parse('2026-06-25T10:00:00+09:00'),
    stream_growth: 410074,
    quality_flags: '["stationhead_email_recap"]',
  }], 'weekly', AFTER_JULY);
  assert.equal(result.excludedCount, 0);
  assert.equal(result.rows[0].stream_growth, 410074);
  assert.equal(result.rows[0].period_complete, true);
});

test('July email-like weekly rows are not covered by the historical exception', () => {
  const evaluation = evaluatePeriodCompleteness({
    mode: 'weekly',
    periodKey: '2026-07-06',
    firstObservedAt: Date.parse('2026-07-06T10:00:00+09:00'),
    lastObservedAt: Date.parse('2026-07-07T10:00:00+09:00'),
    qualityFlags: '["stationhead_email_recap"]',
    now: Date.parse('2026-07-07T12:00:00Z'),
  });
  assert.equal(evaluation.complete, false);
  assert.equal(evaluation.trusted, false);
});

test('track rows retain details but incomplete dates are marked for total exclusion', () => {
  const completeBounds = expectedPeriodBounds('daily', '2026-06-30');
  const result = applyTrackPeriodCompleteness([
    { play_date: '2026-06-30', track_key: 'a', play_count: 3 },
    { play_date: '2026-07-02', track_key: 'b', play_count: 2 },
  ], [
    {
      play_date: '2026-06-30',
      period_first_observed_at: completeBounds.start + 5 * 60000,
      period_last_observed_at: completeBounds.end - 5 * 60000,
    },
    {
      play_date: '2026-07-02',
      period_first_observed_at: Date.parse('2026-07-02T00:05:00Z'),
      period_last_observed_at: AFTER_JULY,
    },
  ], AFTER_JULY);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].play_count, 3);
  assert.equal(result.rows[0].play_count_excluded, false);
  assert.equal(result.rows[1].play_count, 2);
  assert.equal(result.rows[1].play_count_excluded, true);
  assert.deepEqual(result.excludedDates, ['2026-07-02']);
});

test('history lite client is loaded lazily into the integrated dashboard', () => {
  const html = readFileSync(new URL('../site/public/index.html', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../site/public/dashboard-tabs.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../site/public/history/history-main.js', import.meta.url), 'utf8');
  assert.match(html, /id="historyView"/);
  assert.match(tabs, /import\('\/history\/history-main\.js\?v=20260923\.9'\)/);
  assert.doesNotMatch(html, /history-period-completeness\.js|history-copy-fixes\.js|history-track-likes\.js/);

  const runtimeSource = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );
  assert.match(runtimeSource, /state\.rows = Array\.isArray\(data\.rows\) \? data\.rows : \[\]/);
  assert.match(runtimeSource, /history:data-loaded/);
  assert.match(entry, /history-period-chart\.js\?v=20260923\.\d+/);
  assert.doesNotMatch(entry, /history-ranking-missing-gap/);
  assert.doesNotMatch(runtimeSource, /TRACK_COLUMNS|trackDate|trackWeekMode|history-period-completeness|history-track-likes/);
  assert.doesNotMatch(runtimeSource, /mondayJstKey|expectedStart|expectedEnd/);
});
