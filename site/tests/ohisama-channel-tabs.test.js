import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const playbackShell = readFileSync(new URL('../public/stationhead-playback-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/hinata-channel-tabs.js', import.meta.url), 'utf8');

test('Ohisama exposes Buddies-style current, history, played tracks and likes subtabs', () => {
  assert.match(shell, /\/hinata-channel-tabs\.js\?v=/);
  for (const pair of [
    ["value: 'current', label: '現在'", '現在'],
    ["value: 'history', label: '過去'", '過去'],
    ["value: 'played-tracks', label: '再生履歴'", '再生履歴'],
    ["value: 'likes', label: 'いいね'", 'いいね'],
  ]) {
    assert.match(runtime, new RegExp(pair[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), pair[1]);
  }
  assert.match(runtime, /dashboardModeTabs/);
  assert.match(runtime, /dashboardSummary/);
  assert.match(runtime, /dashboardDataCard/);
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
