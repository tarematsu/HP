import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const appleMusicShell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');

test('Buddies visible subtabs follow the shared Stationhead order', () => {
  const likes = stationheadModel.indexOf("value: 'likes', label: 'いいね'");
  const broadcasts = stationheadModel.indexOf("value: 'broadcasts', label: 'リスパ'");
  assert.ok(likes >= 0 && broadcasts > likes);
  assert.match(registry, /STATIONHEAD_CHANNEL_TABS\.map/);
  assert.doesNotMatch(registry, /ranking|spotify/i);
  assert.match(tabsClient, /id: 'ranking', label: 'リーダーボード'/);
});

test('followers is a source route instead of a lazily inserted mode tab', () => {
  assert.match(tabsClient, /id: 'followers', label: 'フォロワー', defaultMode: 'followers'/);
  assert.doesNotMatch(followersShell, /\btab:\s*\{/);
});

test('Apple Music is a source route instead of a lazily inserted mode tab', () => {
  assert.match(tabsClient, /id: 'apple-music', label: 'Apple Music', defaultMode: 'apple-music'/);
  assert.doesNotMatch(appleMusicShell, /\btab:\s*\{/);
});
