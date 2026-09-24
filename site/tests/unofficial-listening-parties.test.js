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
  assert.match(viewSource, /<th>日付<\/th><th>時間<\/th><th>名前<\/th><th>場所<\/th><th>出典<\/th>/);
  assert.doesNotMatch(viewSource, /長さ|duration|最大同接/);
  assert.doesNotMatch(viewSource, /<canvas\b/);
  assert.doesNotMatch(viewSource, /chart-panel/);
});

test('historical unofficial listening party rows use formal hosting channel names', () => {
  const rows = [...viewSource.matchAll(/\{ date: '[^']+'.+?\},/g)];
  assert.equal(rows.length, 15);
  assert.equal((viewSource.match(/place: ''/g) || []).length, 0);
  assert.match(viewSource, /date: '2024\/08\/02'.+place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2024\/09\/07'.+place: 'LOCKEY Stationhead'/);
  assert.match(viewSource, /date: '2024\/11\/01'.+place: 'MINIチャンネル'/);
  assert.match(viewSource, /date: '2024\/12\/13'.+place: 'Team IMP\.'/);
  assert.match(viewSource, /date: '2024\/12\/19'.+place: 'FELIX STREAM STATION'/);
  assert.match(viewSource, /date: '2024\/12\/29'.+place: 'WithUチャンネル'/);
  assert.match(viewSource, /date: '2024\/12\/30'.+place: 'Ohisama CH\.'/);
  assert.doesNotMatch(viewSource, /BUDDIESチャンネル|Buddiesチャンネル|Ohisamaチャンネル|imp714p/);
});

test('expanded history adds only the verified three-Sakamichi joint event', () => {
  assert.match(viewSource, /date: '2025\/07\/19', time: '23:00', name: '#坂道Stationhead DAY1', place: "乃木坂46fan's Stationhead"/);
  assert.match(viewSource, /date: '2025\/07\/20', time: '21:00', name: '#坂道Stationhead DAY2', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/07\/21', time: '22:00', name: '#坂道Stationhead DAY3', place: 'Ohisama CH\.'/);
  assert.doesNotMatch(viewSource, /妄想W-KEYAKI FES\.2026|ケヤキダービー/);
});

test('all historical rows use X announcements and the unified X label', () => {
  assert.equal((viewSource.match(/source: 'https:\/\/x\.com\//g) || []).length, 15);
  assert.doesNotMatch(viewSource, /note\.com|sourceLabel|告知記事/);
  assert.match(viewSource, /sourceLink\.textContent = 'X告知'/);
  assert.match(viewSource, /sourceLink\.target = '_blank'/);
  assert.match(viewSource, /sourceLink\.rel = 'noopener noreferrer'/);
  assert.match(viewSource, /1818995243200758205/);
  assert.match(viewSource, /1831301387424342514/);
  assert.match(viewSource, /1834834469531902262/);
  assert.match(viewSource, /1849435676288196988/);
  assert.match(viewSource, /1851972681962525075/);
  assert.match(viewSource, /1866105637178142945/);
  assert.match(viewSource, /1869336911619494103/);
  assert.match(viewSource, /1872235924760735993/);
  assert.match(viewSource, /1872628541235560835/);
  assert.match(viewSource, /1942191880726528064/);
});

test('dashboard routing recognizes the unofficial view and loads it before tab setup', () => {
  assert.match(tabsSource, /VIEW_MODES = new Set\(\['current', \.\.\.HISTORY_MODES, 'first-week', 'played-tracks', 'likes', 'unofficial'\]\)/);
  assert.match(tabsSource, /button\.dataset\.view === 'unofficial'/);
  assert.match(tabsSource, /showUnofficial\(\)/);

  const unofficialImport = metricsSource.indexOf("import './unofficial-listening-parties.js");
  const tabsImport = metricsSource.indexOf("import './dashboard-tabs.js");
  assert.ok(unofficialImport >= 0 && tabsImport > unofficialImport);
});
