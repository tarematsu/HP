import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const tabsClient = dashboardRouterSource();
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const appleMusicShell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');

test('Buddies visible subtabs follow the shared Stationhead order', () => {
  const likes = stationheadModel.indexOf("value: 'likes', label: 'いいね'");
  const broadcasts = stationheadModel.indexOf("value: 'broadcasts', label: 'リスパ'");
  assert.ok(likes >= 0 && broadcasts > likes);
  assert.match(stationheadShell, /STATIONHEAD_CHANNEL_TABS\.map/);
  assert.match(registry, /tabs\.replaceChildren\(\)/);
  assert.doesNotMatch(registry, /ranking|spotify|STATIONHEAD_CHANNEL_TABS/i);
  assert.match(tabsClient, /mode: 'ranking', label: 'リーダーボード'/);
});

test('followers is a Buddies function with a lazy shared view', () => {
  assert.match(tabsClient, /mode: 'followers', label: 'フォロワー'/);
  assert.doesNotMatch(followersShell, /\btab:\s*\{/);
});

test('Apple Music is a source route instead of a lazily inserted mode tab', () => {
  assert.match(tabsClient, /id: 'apple-music', label: 'Apple Music', defaultMode: 'apple-music'/);
  assert.doesNotMatch(appleMusicShell, /\btab:\s*\{/);
});
