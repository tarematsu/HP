import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Stationhead leaderboard and followers share mobile table DOM, markup and style contracts', () => {
  const table = source('dashboard-table-dom.js');
  const shell = source('dashboard-ui-common.js');
  const css = source('dashboard-responsive-cards.css');
  for (const page of ['leaderboard-shell.js', 'followers-shell.js']) {
    assert.match(source(page), /dashboardUpdateMeta/);
    assert.match(source(page), /mobileCardsId:/);
  }
  assert.match(source('leaderboard/table.js'), /renderResponsiveTable/);
  assert.match(source('followers.js'), /renderResponsiveTable/);
  assert.match(table, /export function renderResponsiveTable/);
  assert.match(shell, /class="dashboard-responsive-cards"/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /\.dashboard-responsive-table \{ display: none;/);
  assert.doesNotMatch(source('leaderboard.css'), /leaderboard-mobile-card|leaderboard-mobile-field/);
});

test('all regional music shells use one chart/history layout factory', () => {
  const shared = source('music-service-shell.js');
  for (const primitive of ['musicServiceSakamichiFilter', 'musicServiceRankingHistoryTable', 'musicServiceRankChart']) {
    assert.match(shared, new RegExp(`export function ${primitive}[(]`));
  }
  assert.match(shared, /export function musicServiceRegionalChartPair/);
  for (const page of ['qq-music-shell.js', 'kugou-music-shell.js', 'kkbox-shell.js']) {
    assert.match(source(page), /musicServiceRegionalChartPair[(]/, `${page} should use the shared chart/history layout`);
    assert.doesNotMatch(source(page), /class="music-service-rank-chart"/);
    assert.doesNotMatch(source(page), /value: 'sakurazaka46', label: '櫻坂'/);
  }
  assert.equal((shared.match(/value: 'sakurazaka46', label: '櫻坂'/g) || []).length, 1);
});

test('service meta delegates to the dashboard meta generator', () => {
  assert.match(source('music-service-shell.js'), /return dashboardUpdateMeta/);
});
