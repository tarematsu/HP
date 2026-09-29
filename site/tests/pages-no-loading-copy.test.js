import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicSources = [
  '../public/index.html',
  '../public/history/history-lite.js',
  '../public/history/history-likes.js',
  '../public/history/history-chart-stability.js',
  '../public/played-tracks.js',
  '../public/first-week-comparison.js',
  '../public/first-week-comparison-shell.js',
  '../public/sakurazaka46jp/index.html',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('Pages does not render transient loading copy', () => {
  for (const copy of ['読み込み中', '読み込んでいます', '読み込みます。', '曲情報を取得中']) {
    assert.doesNotMatch(publicSources, new RegExp(copy));
  }
});

test('silent loading changes are cache busted through the Pages entry chain', () => {
  assert.match(historyEntry, /history-chart-stability\.js\?v=20260925\.1/);
  assert.doesNotMatch(historyEntry, /history-table-cleanup|history-page-fixes|history-summary-average-labels/);
  assert.match(historyEntry, /history-lite\.js\?v=20260930\.1/);
  assert.match(historyEntry, /unofficial-listening-parties\.js\?v=20260927\.1/);
  assert.match(historyEntry, /history-broadcasts\.js\?v=20260927\.1/);
  assert.match(tabs, /history-main\.js\?v=20260928\.1/);
  assert.match(tabs, /first-week-comparison-shell\.js\?v=20260929\.1/);
  assert.match(tabs, /first-week-comparison\.js\?v=20260929\.1/);
  assert.match(tabs, /played-tracks-shell\.js\?v=20260928\.1/);
  assert.match(tabs, /played-tracks\.js\?v=20260927\.2/);
  assert.match(tabs, /history-likes\.js\?v=20260925\.1/);
  assert.match(tabs, /spotify-shell\.js\?v=20260929\.1/);
  assert.match(tabs, /spotify\.js\?v=20260929\.1/);
  assert.match(dashboardEntry, /legacy-listening-party-route\.js\?v=20260926\.1/);
  assert.match(dashboardEntry, /dashboard-tab-order\.js\?v=20260929\.1/);
  assert.match(dashboardEntry, /dashboard-chart-comparison\.js\?v=20260929\.1/);
  assert.match(dashboardEntry, /dashboard-chart-detail\.js\?v=20260929\.1/);
  assert.match(dashboardEntry, /dashboard-details-client\.js\?v=20260929\.2/);
  assert.match(dashboardEntry, /dashboard-client\.js\?v=20260929\.2/);
  assert.match(html, /dashboard-root-presentation\.css\?v=20260930\.1/);
  assert.doesNotMatch(dashboardEntry, /dashboard-root-presentation\.css|history-global-fixes|dashboard-current-metric-style/);
  assert.doesNotMatch(dashboardEntry, /import '.\/unofficial-listening-parties\.js/);
  assert.match(dashboardEntry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.match(html, /dashboard-metrics\.js\?v=20260929\.3/);
});
