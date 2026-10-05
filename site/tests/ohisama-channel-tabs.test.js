import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const buddies = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const ohisama = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const nogizaka = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const runtime = browserSource('stationhead-channel.js');
const readModel = browserSource('stationhead-channel-read-model.js');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const navigationCss = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const sharedCss = navigationCss + readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');

test('all three Stationhead sources mount the exact same shared subtree', () => {
  for (const wrapper of [buddies, ohisama, nogizaka]) {
    assert.match(wrapper, /mountStationheadChannelShell/);
    assert.doesNotMatch(wrapper, /dashboardMetric|dashboardChartCard|dashboardTable|stationheadPlaybackCards/);
  }
  assert.match(buddies, /stationheadModel = 'buddies'/);
  assert.match(ohisama, /stationheadModel = 'ohisama'/);
  assert.match(nogizaka, /stationheadModel = 'nogizaka'/);
  assert.match(shell, /export function stationheadChannelMarkup\(/);
});

test('shared Stationhead subtree exposes exactly the canonical five subtabs', () => {
  for (const [value, label] of [
    ['current', '現在'], ['history', '過去'], ['played-tracks', '再生履歴'], ['likes', 'いいね'], ['broadcasts', 'リスパ'],
  ]) {
    assert.match(stationheadModel, new RegExp(`value: '${value}', label: '${label}'`));
    assert.match(shell, new RegExp(`data-stationhead-panel=\\"${value}\\"`));
  }
  assert.match(shell, /className: 'stationhead-subtabs'/);
  assert.match(runtime, /runtime\.model\.capabilities\.includes\(section\)/);
});

test('Stationhead subtabs share one layout spacing and disabled-state contract', () => {
  assert.match(sharedCss, /\.stationhead-subtabs\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(sharedCss, /\.stationhead-subtabs\s*>\s*button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(sharedCss, /\.stationhead-channel-panel\s*\{[^}]*gap:\s*var\(--pages-view-gap, 12px\)/s);
  assert.match(navigationCss, /\.stationhead-channel-view\s*\{[^}]*margin-top:\s*8px/s);
  assert.match(navigationCss, /\.stationhead-subtabs\s*>\s*button:disabled\s*\{[^}]*text-decoration:\s*line-through/s);
});

test('playback, likes and CSV rendering live only in the shared runtime', () => {
  assert.match(shell, /NOW PLAYING/);
  assert.match(shell, /UP NEXT/);
  assert.match(runtime, /function renderPlayback\(/);
  assert.match(runtime, /className = 'like-rank-item'/);
  assert.match(runtime, /className = 'like-rank-number'/);
  assert.match(runtime, /className = 'like-rank-content'/);
  assert.match(runtime, /className = 'like-rank-metrics'/);
  assert.match(runtime, /downloadCsv/);
  assert.match(readModel, /includes\('日向坂46'\)/);
  assert.match(readModel, /includes\('櫻坂46'\)/);
});
