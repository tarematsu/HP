import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');

test('dashboard title is the hashtag and links to an X search for the same text', () => {
  assert.match(header, /const DASHBOARD_TITLE = '#櫻坂46_ステへ統計'/);
  assert.match(header, /https:\/\/x\.com\/search\?q=\$\{encodeURIComponent\(DASHBOARD_TITLE\)\}&src=typed_query/);
  assert.match(header, /dataset\.dashboardTitleLink = 'true'/);
});

test('header shows dated acquisition and materialized-history refresh times in JST without seconds', () => {
  assert.match(header, /timeZone: 'Asia\/Tokyo'/);
  assert.match(header, /year: 'numeric'/);
  assert.match(header, /month: '2-digit'/);
  assert.match(header, /day: '2-digit'/);
  assert.match(header, /`最終取得 \$\{acquisitionText\}　履歴更新 \$\{historyText\} JST`/);
  assert.match(header, /history:materialized-at/);
  assert.match(header, /UTC_UPDATED_PATTERN/);
  assert.doesNotMatch(header, /JST_DATE_TIME[\s\S]*second:\s*'2-digit'/);
  assert.match(guard, /x-materialized-at/);
  assert.match(guard, /history:materialized-at/);

  // Dashboard/history data timestamps and date-range boundaries remain UTC.
  assert.match(dashboard, /timeZone: 'UTC'/);
  assert.match(dashboard, /UTC/);
  assert.match(history, /timeZone: 'UTC'/);
  assert.match(history, /const todayUtc = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});
