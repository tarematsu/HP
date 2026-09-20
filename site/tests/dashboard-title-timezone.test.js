import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');

test('dashboard title is the hashtag and links to an X search for the same text', () => {
  assert.match(header, /const DASHBOARD_TITLE = '#櫻坂46_ステへ統計'/);
  assert.match(header, /https:\/\/x\.com\/search\?q=\$\{encodeURIComponent\(DASHBOARD_TITLE\)\}&src=typed_query/);
  assert.match(header, /dataset\.dashboardTitleLink = 'true'/);
});

test('only the header last-updated display is converted to JST', () => {
  assert.match(header, /timeZone: 'Asia\/Tokyo'/);
  assert.match(header, /最終取得 .* JST/);
  assert.match(header, /UTC_UPDATED_PATTERN/);

  // Dashboard/history data timestamps and date-range boundaries remain UTC.
  assert.match(dashboard, /timeZone: 'UTC'/);
  assert.match(dashboard, /UTC/);
  assert.match(history, /timeZone: 'UTC'/);
  assert.match(history, /const todayUtc = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});
