import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const playbackShell = readFileSync(new URL('../public/stationhead-playback-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/hinata-channel-tabs.js', import.meta.url), 'utf8');
const stationheadTabs = readFileSync(new URL('../public/stationhead-channel-tabs.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');

test('Ohisama exposes the shared five Stationhead subtabs', () => {
  assert.match(shell, /\/hinata-channel-tabs\.js\?v=/);
  for (const pair of [
    ["value: 'current', label: '現在'", '現在'],
    ["value: 'history', label: '過去'", '過去'],
    ["value: 'played-tracks', label: '再生履歴'", '再生履歴'],
    ["value: 'likes', label: 'いいね'", 'いいね'],
    ["value: 'broadcasts', label: 'リスパ'", 'リスパ'],
  ]) {
    assert.match(stationheadTabs, new RegExp(pair[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), pair[1]);
  }
  assert.match(runtime, /stationheadChannelTabs/);
  assert.match(runtime, /bindStationheadChannelTabs/);
  assert.match(runtime, /stationhead-channel-panel/);
  assert.match(runtime, /broadcastsPanel\.dataset\.hinataPanel = 'broadcasts'/);
});

test('Stationhead subtabs share one layout and panel spacing contract', () => {
  assert.match(sharedCss, /\.stationhead-subtabs\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(sharedCss, /\.stationhead-subtabs\s*>\s*button\s*\{[^}]*min-height:\s*40px/s);
  assert.match(sharedCss, /\.stationhead-channel-panel\s*\{[^}]*gap:\s*var\(--pages-view-gap, 12px\)/s);
  assert.match(sharedCss, /@media \(max-width: 760px\)[\s\S]*\.stationhead-channel-panel\s*\{[^}]*--pages-view-gap-mobile/s);
});

test('Buddies and Ohisama reuse the same Stationhead playback shell component', () => {
  assert.match(currentShell, /stationheadPlaybackCards/);
  assert.match(runtime, /stationheadPlaybackCards/);
  assert.match(playbackShell, /NOW PLAYING/);
  assert.match(playbackShell, /UP NEXT/);
});

test('Ohisama runtime renders current queue, daily playback counts and likes', () => {
  assert.match(runtime, /slice\(Math\.max\(0, view\.index \+ 1\).*\+ 5\)/);
  assert.match(runtime, /hinataPlayedTotal/);
  assert.match(runtime, /hinataPlayedUnique/);
  assert.match(runtime, /hinataLikesTotalLikes/);
  assert.match(runtime, /data-hinata-panel|hinataPanel/);
});
