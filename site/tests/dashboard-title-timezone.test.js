import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const dashboard = browserSource('stationhead-channel.js');
const history = browserSource('history/history-lite.js');
const historyData = readFileSync(new URL('../public/history/history-data-client.js', import.meta.url), 'utf8');

test('dashboard title is final in initial HTML and links to an X search for the same text', () => {
  assert.match(page, /<title>#櫻坂46_ステへ統計<\/title>/);
  assert.match(page, /<h1 id="channelName"><a data-dashboard-title-link="true"[^>]*>#櫻坂46_ステへ統計<\/a><\/h1>/);
  assert.match(page, /https:\/\/x\.com\/search\?q=%23%E6%AB%BB%E5%9D%8246_%E3%82%B9%E3%83%86%E3%81%B8%E7%B5%B1%E8%A8%88&amp;src=typed_query/);
  assert.doesNotMatch(header, /DASHBOARD_TITLE|document\.title\s*=|channelName\.replaceChildren|dashboardTitleLink/);
});

test('header shows the dashboard materialization time in JST without seconds', () => {
  assert.match(header, /const JST_TIME = new Intl\.DateTimeFormat/);
  assert.match(header, /timeZone: 'Asia\/Tokyo'/);
  assert.match(header, /hour: '2-digit'/);
  assert.match(header, /minute: '2-digit'/);
  assert.doesNotMatch(header, /year: 'numeric'/);
  assert.doesNotMatch(header, /month: '2-digit'/);
  assert.doesNotMatch(header, /day: '2-digit'/);
  assert.match(header, /const next = `更新 \$\{refreshText\}`/);
  assert.match(header, /updated\.title = `更新 \$\{refreshText\} JST`/);
  assert.doesNotMatch(header, /5分毎/);
  assert.match(header, /dashboard:materialized-at/);
  assert.doesNotMatch(header, /history:materialized-at/);
  assert.doesNotMatch(header, /UTC_UPDATED_PATTERN/);
  assert.doesNotMatch(header, /acquisitionUpdatedAt/);
  assert.doesNotMatch(header, /JST_TIME[\s\S]*second:\s*'2-digit'/);
  assert.doesNotMatch(metrics, /response\?\.headers\?\.get\('x-materialized-at'\)|dashboard:materialized-at/);
  assert.match(fetchCache, /response\?\.headers\?\.get\('x-materialized-at'\)/);
  assert.match(fetchCache, /dashboard:materialized-at/);
  assert.doesNotMatch(historyData, /history:materialized-at|x-materialized-at/);

  assert.doesNotMatch(dashboard, /timeZone:\s*'UTC'|最終取得 .* UTC/);
  assert.match(history, /timeZone: 'UTC'/);
  assert.match(history, /const todayUtc = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test('dashboard materialized time is restored immediately and updated from the existing dashboard response', () => {
  assert.match(header, /DASHBOARD_MATERIALIZED_AT_CACHE_KEY = 'sh\.dashboard\.materialized-at\.v1'/);
  assert.match(header, /localStorage\.getItem\(DASHBOARD_MATERIALIZED_AT_CACHE_KEY\)/);
  assert.match(header, /localStorage\.setItem\(DASHBOARD_MATERIALIZED_AT_CACHE_KEY, String\(value\)\)/);
  assert.match(header, /let dashboardMaterializedAt = cachedDashboardMaterializedAt\(\)/);
  assert.match(header, /setDashboardMaterializedAt\(event\?\.detail\?\.updatedAt\)/);
  assert.doesNotMatch(header, /fetch\(`\/api\/history/);
  assert.doesNotMatch(header, /refreshHistoryMaterializedAt/);
  assert.match(fetchCache, /announceMaterializedAt\(response\)/);
});
