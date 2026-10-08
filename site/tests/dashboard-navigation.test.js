import { NAVIGATION, navigationForMode } from '../public/dashboard-navigation-config.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const route = dashboardRouterSource();
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('dashboard exposes Stationhead and music streaming service top-level categories', () => {
  assert.match(index, /id="sectionTabs"/);
  assert.match(index, /data-section="stationhead"[^>]*>Stationhead</);
  assert.match(index, /data-section="subscriptions"[^>]*>[\s\S]*音楽ストリーミングサービス</);
  assert.doesNotMatch(index, /data-section="analysis"/);
  assert.doesNotMatch(index, />比較・分析</);
  assert.match(index, /id="sourceTabs"/);
  assert.match(index, /id="functionTabs"/);
});

test('Stationhead separates channels from Buddies functions', () => {
  assert.deepEqual(NAVIGATION[0].sources.map(source => source.id), ['buddies', 'hinata', 'nogizaka']);
  for (const mode of ['ranking', 'followers']) {
    assert.equal(navigationForMode(mode).section.id, 'stationhead');
    assert.equal(navigationForMode(mode).source.id, 'buddies');
  }
});

test('music streaming section contains only streaming service views', () => {
  const subscriptions = route.indexOf("id: 'subscriptions'");
  const spotify = route.indexOf("id: 'spotify'", subscriptions);
  const kugou = route.indexOf("id: 'kugou_music'", subscriptions);
  assert.ok(subscriptions >= 0 && spotify > subscriptions && kugou > spotify);
  assert.doesNotMatch(route, /id: 'music-ranking'|id: 'music-followers'/);
  assert.doesNotMatch(route, /'music-ranking':|'music-followers':/);
});

test('Buddies functions include archive and aggregate views and normalize legacy listening-party links', () => {
  assert.deepEqual(NAVIGATION[0].sources[0].functions.map(item => item.mode),
    ['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts', 'ranking', 'followers']);
  assert.match(route, /mode === 'first-week' \|\| mode === 'unofficial'[\s\S]*#broadcasts/);
  assert.doesNotMatch(route, /new MutationObserver/);
});

test('in-app route changes notify hash-driven views after pushState', () => {
  assert.match(route, /const oldURL = location\.href;/);
  assert.match(route, /history\[replace \? 'replaceState' : 'pushState'\]\(null, '', target\);/);
  assert.match(route, /new HashChangeEvent\('hashchange', \{ oldURL, newURL: location\.href \}\)/);
});

test('navigation styles are bundled and responsive', () => {
  assert.match(build, /'dashboard-navigation\.css'/);
  assert.match(css, /\.dashboard-section-tabs/);
  assert.match(css, /\.dashboard-source-tabs/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
