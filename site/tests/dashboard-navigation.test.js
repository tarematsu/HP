import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('dashboard exposes Stationhead and music streaming service top-level categories', () => {
  assert.match(index, /id="sectionTabs"/);
  assert.match(index, /data-section="stationhead"[^>]*>Stationhead</);
  assert.match(index, /data-section="subscriptions"[^>]*>音楽ストリーミングサービス</);
  assert.doesNotMatch(index, /data-section="analysis"/);
  assert.doesNotMatch(index, />比較・分析</);
  assert.match(index, /id="sourceTabs"/);
  assert.match(index, /id="modeTabs"/);
});

test('Stationhead sources are Buddies, Ohisama, Nogizaka, leaderboard and followers', () => {
  const buddies = route.indexOf("id: 'buddies'");
  const hinata = route.indexOf("id: 'hinata', label: 'Ohisama'");
  const nogizaka = route.indexOf("id: 'nogizaka', label: 'Nogizaka'");
  const ranking = route.indexOf("id: 'ranking', label: 'リーダーボード'");
  const followers = route.indexOf("id: 'followers', label: 'フォロワー'");
  const subscriptions = route.indexOf("id: 'subscriptions'");
  assert.ok(buddies >= 0 && hinata > buddies && nogizaka > hinata && ranking > nogizaka && followers > ranking && subscriptions > followers);
  assert.match(route, /id: 'subscriptions'[\s\S]*id: 'spotify'[\s\S]*id: 'apple-music'[\s\S]*id: 'amazon-music'/);
  assert.doesNotMatch(route, /id: 'analysis'/);
});

test('Buddies keeps first-week comparison inside listening parties while global leaderboard and followers stay outside its view tabs', () => {
  assert.match(route, /id: 'buddies',[\s\S]*modes: Object\.freeze\(\['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts'\]\)/);
  assert.match(route, /const BUDDIES_VISIBLE_MODES = new Set\(\['current', 'daily', 'played-tracks', 'likes', 'broadcasts'\]\)/);
  assert.doesNotMatch(route, /'first-week': \{/);
  assert.match(route, /mode === 'first-week'[\s\S]*#broadcasts/);
  assert.match(route, /const showBuddiesModes = source\.id === 'buddies'/);
  assert.match(route, /tabs\.hidden = !showBuddiesModes/);
  assert.match(route, /new MutationObserver/);
});

test('in-app route changes notify hash-driven views after pushState', () => {
  assert.match(route, /const oldURL = location\.href;/);
  assert.match(route, /history\[replace \? 'replaceState' : 'pushState'\]\(null, '', target\);/);
  assert.match(route, /new HashChangeEvent\('hashchange', \{ oldURL, newURL \}\)/);
});

test('navigation styles are bundled and responsive', () => {
  assert.match(build, /'dashboard-navigation\.css'/);
  assert.match(css, /\.dashboard-section-tabs/);
  assert.match(css, /\.dashboard-source-tabs/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
