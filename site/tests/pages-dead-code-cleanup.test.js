import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const stationheadReadModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');

const removedAssets = [
  'app-playback.js', 'app-state.js', 'comment-velocity-chart.css', 'dashboard-current-enhancements.js',
  'dashboard-current-metric-style.js', 'dashboard-display-guards.js', 'dashboard-dom-utils.js',
  'dashboard-history-cache.js', 'dashboard-interactive.css', 'dashboard-optimized.js', 'design-system.css',
  'eta-daypart.js', 'pages-terminology.js', 'pages-ui-tweaks.js', 'sh-ui-fixes.js', 'style-base.css', 'style.css',
];

const removedHistoryAssets = [
  'history.js', 'history-mode-selectors.js', 'history-default-range.js', 'history-global-fixes.js',
  'history-page-fixes.js', 'history-table-cleanup.js', 'history-summary-average-labels.js',
];

test('unreferenced legacy and post-render correction assets are removed from the deploy tree', () => {
  for (const file of removedAssets) assert.equal(existsSync(new URL(`../public/${file}`, import.meta.url)), false, file);
  for (const file of removedHistoryAssets) assert.equal(existsSync(new URL(`../public/history/${file}`, import.meta.url)), false, file);
});

test('current view ships the same final Stationhead DOM as Ohisama and Nogizaka', () => {
  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(currentShell, /stationheadModel = 'buddies'/);
  assert.match(stationheadShell, /class="primary-grid"/);
  assert.match(stationheadShell, /role\('station-link'\)/);
  assert.match(stationheadShell, /role\('live-chart'\)/);
  assert.match(stationheadReadModel, /station_url: 'https:\/\/stationhead\.com\/c\/buddies'/);
  assert.doesNotMatch(stationheadShell, /goal-card|streamCount|goalBar|goalPercent|goalRemaining|goalRate|goalMilestones|metricGoalCompact|streamGoal|goalEta/);
  assert.doesNotMatch(stationheadRuntime, /MutationObserver|insertAdjacent|\.appendChild\(.*stationhead-channel-panel/);
  assert.doesNotMatch(history, /createTreeWalker|history-page-fixes|history-table-cleanup|history-summary-average-labels/);
});

test('shared renderer no longer writes to DOM that was always deleted or overwritten', () => {
  assert.doesNotMatch(stationheadRuntime, /renderGoal|goalBar|goalPercent|goalRemaining|goalRate|goalMilestones|liveState|liveDot|description/);
  assert.doesNotMatch(stationheadRuntime, /nowPlayingLink[\s\S]*spotifyUrl|spotifyHint[\s\S]*Spotifyで開く/);
  assert.doesNotMatch(header, /description|live-line|app-launch|dashboard-actions|channelObserver|updatedObserver/);
  assert.doesNotMatch(likes, /likesLoad/);
});
