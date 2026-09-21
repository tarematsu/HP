import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');

test('dashboard title is the hashtag, browser title, and links to an X search for the same text', () => {
  assert.match(header, /const DASHBOARD_TITLE = '#櫻坂46_ステへ統計'/);
  assert.match(header, /document\.title = DASHBOARD_TITLE/);
  assert.match(header, /https:\/\/x\.com\/search\?q=\$\{encodeURIComponent\(DASHBOARD_TITLE\)\}&src=typed_query/);
  assert.match(header, /dataset\.dashboardTitleLink = 'true'/);
});

test('header shows only the materialized-history update time in JST without seconds', () => {
  assert.match(header, /const JST_TIME = new Intl\.DateTimeFormat/);
  assert.match(header, /timeZone: 'Asia\/Tokyo'/);
  assert.match(header, /hour: '2-digit'/);
  assert.match(header, /minute: '2-digit'/);
  assert.doesNotMatch(header, /year: 'numeric'/);
  assert.doesNotMatch(header, /month: '2-digit'/);
  assert.doesNotMatch(header, /day: '2-digit'/);
  assert.match(header, /const next = `更新 \$\{historyText\}`/);
  assert.match(header, /updated\.title = `更新 \$\{historyText\} JST`/);
  assert.match(header, /history:materialized-at/);
  assert.doesNotMatch(header, /UTC_UPDATED_PATTERN/);
  assert.doesNotMatch(header, /acquisitionUpdatedAt/);
  assert.doesNotMatch(header, /JST_TIME[\s\S]*second:\s*'2-digit'/);
  assert.match(guard, /x-materialized-at/);
  assert.match(guard, /history:materialized-at/);

  // Dashboard/history data timestamps and date-range boundaries remain UTC.
  assert.match(dashboard, /timeZone: 'UTC'/);
  assert.match(dashboard, /UTC/);
  assert.match(history, /timeZone: 'UTC'/);
  assert.match(history, /const todayUtc = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test('history materialized time is restored immediately and refreshed from a tiny materialized history request', () => {
  assert.match(header, /HISTORY_MATERIALIZED_AT_CACHE_KEY = 'sh\.history\.materialized-at\.v1'/);
  assert.match(header, /localStorage\.getItem\(HISTORY_MATERIALIZED_AT_CACHE_KEY\)/);
  assert.match(header, /localStorage\.setItem\(HISTORY_MATERIALIZED_AT_CACHE_KEY, String\(value\)\)/);
  assert.match(header, /let historyMaterializedAt = cachedHistoryMaterializedAt\(\)/);
  assert.match(header, /fetch\(`\/api\/history\?mode=daily&from=\$\{todayUtc\}&to=\$\{todayUtc\}`/);
  assert.match(header, /response\.headers\.get\('x-materialized-at'\)/);
  assert.match(header, /await response\.arrayBuffer\(\)/);
  assert.doesNotMatch(header, /response\.body\?\.cancel|response\.body\.cancel/);
  assert.match(header, /void refreshHistoryMaterializedAt\(\)/);
});
