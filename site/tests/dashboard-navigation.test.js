import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('dashboard exposes three top-level data categories', () => {
  assert.match(index, /id="sectionTabs"/);
  assert.match(index, /data-section="stationhead"[^>]*>Stationhead</);
  assert.match(index, /data-section="subscriptions"[^>]*>音楽サブスク</);
  assert.match(index, /data-section="analysis"[^>]*>比較・分析</);
  assert.match(index, /id="sourceTabs"/);
  assert.match(index, /id="modeTabs"/);
});

test('Stationhead sources and subscription services are grouped by purpose', () => {
  assert.match(route, /id: 'buddies',[\s\S]*label: 'Buddies'/);
  assert.match(route, /id: 'nogizaka', label: 'nogizaka46smej'/);
  assert.match(route, /id: 'hinata', label: 'Ohisama'/);
  assert.match(route, /id: 'subscriptions'[\s\S]*id: 'spotify'[\s\S]*id: 'apple-music'[\s\S]*id: 'amazon-music'/);
  assert.match(route, /id: 'analysis'[\s\S]*id: 'first-week'/);
});

test('only Buddies exposes the third-level view navigation', () => {
  assert.match(route, /const showBuddiesModes = source\.id === 'buddies'/);
  assert.match(route, /tabs\.hidden = !showBuddiesModes/);
  assert.match(route, /BUDDIES_VISIBLE_MODES/);
  assert.match(route, /new MutationObserver/);
});

test('navigation styles are bundled and responsive', () => {
  assert.match(build, /'dashboard-navigation\.css'/);
  assert.match(css, /\.dashboard-section-tabs/);
  assert.match(css, /\.dashboard-source-tabs/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
