import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/apple-music.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/apple-music.js', import.meta.url), 'utf8');

test('Apple Music is a dashboard route backed only by the Worker materialized read model', () => {
  assert.match(tabs, /VIEW_MODES[\s\S]*'apple-music'/);
  assert.match(tabs, /import\('\/apple-music-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabs, /import\('\/apple-music\.js\?v=20260930\.1'\)/);
  assert.match(tabs, /showAppleMusic/);
  assert.match(runtime, /fetch\('\/api\/apple-music'/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=apple-music/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /\/api\/history|\/api\/dashboard|OTHER_DB|MINUTE_DB/);
});

test('Apple Music view exposes region switcher, rank history, daily changes, and comparison', () => {
  assert.match(shell, /id="appleRegionTabs"/);
  assert.match(shell, /id="appleRankChart"/);
  assert.match(shell, /id="appleMusicTbody"/);
  assert.match(shell, /id="appleRegionCompareTable"/);
  assert.match(shell, /前日比/);
  assert.match(runtime, /let selectedRegion = 'jp'/);
  assert.match(runtime, /rankChangeLabel/);
  assert.match(runtime, /'NEW'/);
  assert.match(runtime, /renderRegionComparison/);
});

test('Apple Music rank chart keeps first place at the top and remains mobile-width safe', () => {
  assert.match(runtime, /yFor = \(rank\) => margin\.top \+ \(rank - 1\)/);
  assert.match(runtime, /Apple Music櫻坂46人気曲順位推移。1位が上。/);
  assert.match(css, /\.apple-rank-svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.apple-region-table[\s\S]*min-width:\s*720px/);
  assert.match(css, /\.apple-region-table-wrap[\s\S]*overflow-x:\s*auto/);
});
