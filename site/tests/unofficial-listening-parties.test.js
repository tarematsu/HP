import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewSource = await readFile(new URL('../public/unofficial-listening-parties.js', import.meta.url), 'utf8');
const tabsSource = await readFile(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const metricsSource = await readFile(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('unofficial listening party tab is mounted immediately after the official tab', () => {
  assert.match(viewSource, /querySelector\('\[data-mode="broadcasts"\]'\)/);
  assert.match(viewSource, /insertAdjacentElement\('afterend', button\)/);
  assert.match(viewSource, /button\.textContent = '非公式リスパ'/);
});

test('unofficial listening party view is table-only with the requested columns', () => {
  assert.match(viewSource, /<th>日付<\/th><th>時間<\/th><th>長さ<\/th><th>最大同接<\/th><th>名前<\/th><th>場所<\/th>/);
  assert.doesNotMatch(viewSource, /<canvas\b/);
  assert.doesNotMatch(viewSource, /chart-panel/);
});

test('historical unofficial listening party rows and known locations are embedded', () => {
  const rows = [...viewSource.matchAll(/\{ date: '[^']+'.+?\},/g)];
  assert.equal(rows.length, 12);
  assert.match(viewSource, /date: '2024\/09\/15'.+maxListeners: 1200/);
  assert.match(viewSource, /date: '2024\/10\/25'.+maxListeners: 403.+place: 'BUDDIESチャンネル'/);
  assert.match(viewSource, /date: '2024\/12\/13'.+maxListeners: 173.+place: 'imp714p'/);
  assert.match(viewSource, /date: '2025\/01\/03'.+maxListeners: 307.+place: 'Buddiesチャンネル'/);
  assert.equal((viewSource.match(/duration: ''/g) || []).length, 12);
});

test('dashboard routing recognizes the unofficial view and loads it before tab setup', () => {
  assert.match(tabsSource, /VIEW_MODES = new Set\(\['current', \.\.\.HISTORY_MODES, 'likes', 'unofficial'\]\)/);
  assert.match(tabsSource, /button\.dataset\.view === 'unofficial'/);
  assert.match(tabsSource, /showUnofficial\(\)/);

  const unofficialImport = metricsSource.indexOf("import './unofficial-listening-parties.js");
  const tabsImport = metricsSource.indexOf("import './dashboard-tabs.js");
  assert.ok(unofficialImport >= 0 && tabsImport > unofficialImport);
});
