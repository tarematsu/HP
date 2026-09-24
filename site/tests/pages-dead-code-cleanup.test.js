import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const tweaks = readFileSync(new URL('../public/pages-ui-tweaks.js', import.meta.url), 'utf8');
const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');

const removedAssets = [
  'app-playback.js',
  'app-state.js',
  'comment-velocity-chart.css',
  'dashboard-current-enhancements.js',
  'dashboard-display-guards.js',
  'dashboard-dom-utils.js',
  'dashboard-history-cache.js',
  'dashboard-interactive.css',
  'dashboard-optimized.js',
  'design-system.css',
  'eta-daypart.js',
  'sh-ui-fixes.js',
  'style-base.css',
  'style.css',
];

const removedHistoryAssets = [
  'history.js',
  'history-mode-selectors.js',
  'history-default-range.js',
];

test('unreferenced legacy Pages assets are removed from the deploy tree', () => {
  for (const file of removedAssets) {
    assert.equal(existsSync(new URL(`../public/${file}`, import.meta.url)), false, file);
  }
  for (const file of removedHistoryAssets) {
    assert.equal(existsSync(new URL(`../public/history/${file}`, import.meta.url)), false, file);
  }
});

test('current view ships its final DOM instead of deleting or moving it at startup', () => {
  assert.match(page, /id="metricGoalCompact"/);
  assert.match(page, /id="streamGoal"/);
  assert.match(page, /id="goalEta"/);
  assert.match(page, /href="https:\/\/stationhead\.com\/c\/buddies"/);
  assert.ok(page.indexOf('class="card chart-card"') < page.indexOf('class="primary-grid"'));
  assert.doesNotMatch(page, /goal-card|id="streamCount"|id="goalBar"|id="goalPercent"|id="goalRemaining"|id="goalRate"|id="goalMilestones"/);
  assert.doesNotMatch(page, /id="description"|class="live-line"|class="app-launch"|class="dashboard-actions"|id="likesLoad"/);
  assert.doesNotMatch(layout, /MutationObserver|querySelector\('\.goal-card'\)|ensureMetricLayout|enforceStationheadLink|\.remove\(|\.append\(/);
  assert.doesNotMatch(tweaks, /primaryGrid|chartCard|likesLoad|replaceWith|\.remove\(|\.append\(/);
});

test('renderers no longer write to DOM that was always deleted or overwritten', () => {
  assert.doesNotMatch(client, /renderGoal|goalBar|goalPercent|goalRemaining|goalRate|goalMilestones|liveState|liveDot|description/);
  assert.doesNotMatch(client, /nowPlayingLink[\s\S]*spotifyUrl|spotifyHint[\s\S]*Spotifyで開く/);
  assert.doesNotMatch(header, /description|live-line|app-launch|dashboard-actions|channelObserver|updatedObserver/);
  assert.doesNotMatch(likes, /likesLoad/);
});
