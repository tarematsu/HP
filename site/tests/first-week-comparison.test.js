import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FIRST_WEEK_RELEASES,
  FIRST_WEEK_SERIES_SQL,
  loadFirstWeekComparison,
  normalizeFirstWeekRows,
  releaseOverlapsKnownGap,
  releaseStartMs,
} from '../functions/lib/first-week-comparison.js';
import { onRequestGet } from '../functions/api/first-week-comparison.js';

const byTitle = (title) => FIRST_WEEK_RELEASES.find((item) => item.title === title);

test('title-track prerelease windows start at JST midnight and cover 10th through 16th', () => {
  assert.equal(FIRST_WEEK_RELEASES.length, 8);
  assert.equal(FIRST_WEEK_RELEASES[0].title, 'I want tomorrow to come');
  assert.equal(FIRST_WEEK_RELEASES.at(-1).title, '愛MUST BE');
  assert.equal(
    releaseStartMs(FIRST_WEEK_RELEASES[0]),
    Date.parse('2024-09-24T15:00:00Z'),
  );
  assert.deepEqual(
    FIRST_WEEK_RELEASES.filter((item) => item.single === '15th').map((item) => item.title),
    ['What\'s “KAZOKU”?', 'Lonesome rabbit'],
  );
});

test('known 2026 collection gap suppresses affected title tracks instead of inventing zeroes', () => {
  assert.equal(releaseOverlapsKnownGap(byTitle('The growing up train')), true);
  assert.equal(releaseOverlapsKnownGap(byTitle('What\'s “KAZOKU”?')), true);
  assert.equal(releaseOverlapsKnownGap(byTitle('Lonesome rabbit')), true);
  assert.equal(releaseOverlapsKnownGap(byTitle('愛MUST BE')), false);
});

test('five-minute series query seeks the minute index and uses canonical stream semantics', () => {
  assert.match(FIRST_WEEK_SERIES_SQL, /INDEXED BY idx_sh_minute_facts_time/);
  assert.match(FIRST_WEEK_SERIES_SQL, /source_code IN \(3,4\)/);
  assert.match(FIRST_WEEK_SERIES_SQL, /current_stream_count IS NOT total_listens/);
  assert.match(FIRST_WEEK_SERIES_SQL, /bucket_index\*5 AS elapsed_minutes/);
});

test('stream growth is rebased to the first observed point without masking counter regressions as growth', () => {
  assert.deepEqual(normalizeFirstWeekRows([
    { elapsed_minutes: 0, listener_count: 100, stream_count: 1_000 },
    { elapsed_minutes: 5, listener_count: 105, stream_count: 1_025 },
    { elapsed_minutes: 10, listener_count: 110, stream_count: 900 },
  ]), [
    [0, 100, 0],
    [5, 105, 25],
    [10, 110, null],
  ]);
});

test('loader skips the known gap and batches only queryable release weeks', async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          prepared.push(this);
          return this;
        },
      };
      return statement;
    },
    async batch(statements) {
      assert.equal(statements.length, 5);
      return statements.map((statement, index) => ({
        results: index === 0
          ? [{ elapsed_minutes: 0, listener_count: 866, stream_count: 1000 }]
          : [],
      }));
    },
  };

  const result = await loadFirstWeekComparison(db);
  assert.equal(prepared.length, 5);
  assert.equal(result.series.length, 8);
  assert.equal(result.series[0].status, 'available');
  assert.equal(result.series[0].points[0][1], 866);
  assert.equal(byTitle('The growing up train').release_date_jst, '2026-02-12');
  assert.equal(result.series.find((item) => item.title === 'The growing up train').status, 'known_missing');
  assert.equal(result.series.find((item) => item.title === '愛MUST BE').status, 'no_data');
});

test('API rejects missing minute database binding', async () => {
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'MINUTE_DB binding missing');
});

test('dashboard mounts and routes the first-week tab before the lazy runtime starts', () => {
  const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../public/first-week-comparison-shell.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/first-week-comparison.css', import.meta.url), 'utf8');

  assert.ok(entry.indexOf('first-week-comparison-shell.js') < entry.indexOf('dashboard-tabs.js'));
  assert.match(shell, /dataset\.view = 'first-week'/);
  assert.match(shell, /textContent = '初週比較'/);
  assert.match(tabs, /'first-week'/);
  assert.match(tabs, /first-week-comparison\.js\?v=20260925\.1/);
  assert.match(css, /repeat\(10, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
