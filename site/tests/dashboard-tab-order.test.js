import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const stationheadTabs = readFileSync(new URL('../public/stationhead-channel-tabs.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const appleMusicShell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');

test('Buddies visible subtabs follow the shared Stationhead order', () => {
  const likes = stationheadTabs.indexOf("value: 'likes', label: 'いいね'");
  const broadcasts = stationheadTabs.indexOf("value: 'broadcasts', label: 'リスパ'");
  assert.ok(likes >= 0 && broadcasts > likes);
  assert.match(registry, /STATIONHEAD_CHANNEL_TABS\.map/);
  assert.match(registry, /view: 'history', mode: 'ranking', label: 'リーダーボード'/);
});

test('followers tab is inserted immediately after first-week comparison', () => {
  assert.match(followersShell, /anchorSelector: '\[data-view="first-week"\]'/);
  assert.match(followersShell, /position: 'afterend'/);
});

test('Apple Music tab is inserted immediately before Spotify', () => {
  assert.match(appleMusicShell, /anchorSelector: '\[data-view="spotify"\]'/);
  assert.match(appleMusicShell, /position: 'beforebegin'/);
});