import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isKnownMissingPeriod,
  knownMissingPeriodKeys,
  materializeKnownMissingPeriods,
} from '../functions/lib/known-history-gap.js';

const materializedSource = readFileSync(
  new URL('../functions/lib/materialized-history.js', import.meta.url),
  'utf8',
);
const gapSource = readFileSync(
  new URL('../functions/lib/known-history-gap.js', import.meta.url),
  'utf8',
);
const chartSource = readFileSync(
  new URL('../public/history/history-period-chart.js', import.meta.url),
  'utf8',
);

test('known gap expands to daily, weekly, and monthly read-model periods', () => {
  assert.equal(knownMissingPeriodKeys('daily').length, 160);
  assert.equal(knownMissingPeriodKeys('daily')[0], '2026-01-14');
  assert.equal(knownMissingPeriodKeys('daily').at(-1), '2026-06-22');

  assert.equal(knownMissingPeriodKeys('weekly').length, 24);
  assert.equal(knownMissingPeriodKeys('weekly')[0], '2026-01-12');
  assert.equal(knownMissingPeriodKeys('weekly').at(-1), '2026-06-22');

  assert.deepEqual(knownMissingPeriodKeys('monthly'), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
  ]);
});

test('known gap replaces any stored values only in the returned read model', () => {
  const rows = materializeKnownMissingPeriods([
    { period_key: '2026-01-13', listener_avg: 101 },
    { period_key: '2026-01-14', listener_avg: 999, sample_count: 1440 },
    { period_key: '2026-06-23', listener_avg: 202 },
  ], 'daily', '2026-01-13', '2026-06-23');

  const before = rows.find((row) => row.period_key === '2026-01-13');
  const missing = rows.find((row) => row.period_key === '2026-01-14');
  const after = rows.find((row) => row.period_key === '2026-06-23');

  assert.equal(before.listener_avg, 101);
  assert.equal(missing.known_missing, true);
  assert.equal(missing.listener_avg, '-');
  assert.equal(missing.sample_count, '-');
  assert.equal(after.listener_avg, 202);
});

test('current or future gap periods are not materialized yet', () => {
  const now = Date.parse('2026-01-14T12:00:00Z');
  const rows = materializeKnownMissingPeriods([], 'daily', '2026-01-14', '2026-01-15', now);
  assert.deepEqual(rows, []);
});

test('weekly and monthly periods overlapping the gap are treated as missing', () => {
  assert.equal(isKnownMissingPeriod('weekly', '2026-01-12'), true);
  assert.equal(isKnownMissingPeriod('weekly', '2026-06-22'), true);
  assert.equal(isKnownMissingPeriod('weekly', '2026-06-29'), false);
  assert.equal(isKnownMissingPeriod('monthly', '2026-01'), true);
  assert.equal(isKnownMissingPeriod('monthly', '2026-06'), true);
  assert.equal(isKnownMissingPeriod('monthly', '2026-07'), false);
});

test('known missing rows are never persisted to D1', () => {
  assert.doesNotMatch(gapSource, /\.prepare\(|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.match(materializedSource, /isKnownMissingPeriod\(mode, key\)/);
  assert.match(materializedSource, /rows: materializeKnownMissingPeriods\(enrichedRows, mode, from, to, now\)/);
  assert.match(materializedSource, /if \(!key \|\| key >= currentKey \|\| isKnownMissingPeriod\(mode, key\)/);
});

test('period chart paints known missing read-model rows as a gray band', () => {
  assert.match(chartSource, /known_missing === true/);
  assert.match(chartSource, /rgba\(100, 107, 116, \.16\)/);
  assert.match(chartSource, /appendLegend\('欠測'/);
  assert.match(chartSource, /灰色は欠測期間です。/);
});
