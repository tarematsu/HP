import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewSource = await readFile(new URL('../public/unofficial-listening-parties.js', import.meta.url), 'utf8');
const registrySource = await readFile(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const metricsSource = await readFile(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const historyEntry = await readFile(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const legacyRoute = await readFile(new URL('../public/legacy-listening-party-route.js', import.meta.url), 'utf8');

const eventRows = [...viewSource.matchAll(/^  \['\d{4}\/\d{2}\/\d{2}'.+?\],$/gm)].map(([row]) => row);

test('official and unofficial listening parties share one top-level リスパ tab', () => {
  assert.match(registrySource, /view: 'history', mode: 'broadcasts', label: 'リスパ'/);
  assert.doesNotMatch(registrySource, /label: '(?:Listening Party|リスニングパーティ)'/);
  assert.doesNotMatch(registrySource, /view: 'unofficial'/);
  assert.doesNotMatch(viewSource, /button\.dataset\.view = 'unofficial'|button\.textContent = '非公式リスパ'/);
});

test('unofficial listening party list is appended below the shared official view', () => {
  assert.match(viewSource, /getElementById\('historyView'\)/);
  assert.match(viewSource, /section\.id = PANEL_ID/);
  assert.match(viewSource, /history\.append\(section\)/);
  assert.match(viewSource, /<h2>非公式リスパ一覧<\/h2>/);
  assert.match(viewSource, /<th>日付<\/th><th>開始時刻<\/th><th>種別<\/th><th>イベント名<\/th><th>開催チャンネル<\/th><th>出典<\/th>/);
  assert.match(viewSource, /\[event\.date, event\.time, event\.type, event\.name, event\.place\]/);
  assert.doesNotMatch(viewSource, /長さ|duration|最大同接/);
});

test('unofficial list contains collaborations only and stores the shared type once', () => {
  assert.equal(eventRows.length, 22);
  assert.equal((viewSource.match(/type: 'コラボ'/g) || []).length, 1);
  assert.match(viewSource, /type: 'コラボ'/);
  assert.doesNotMatch(viewSource, /type: '単独'/);
  assert.doesNotMatch(viewSource, /東京ドーム公演セトリ再現|Addiction.+配信記念リスニング/);
});

test('collaboration rows retain formal hosting channel names through the compact place table', () => {
  for (const place of [
    'BUDDIES STATIONHEAD', 'LOCKEY Stationhead', 'MINIチャンネル', 'Team IMP.',
    'FELIX STREAM STATION', 'WithUチャンネル', 'Ohisama CH.', "乃木坂46fan's Stationhead",
  ]) assert.match(viewSource, new RegExp(place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(viewSource, /\['2024\/08\/02', '22:30'.+, 0, 0, '1818995243200758205'\]/);
  assert.match(viewSource, /\['2024\/09\/07', '22:00'.+, 1, 0, '1831301387424342514'\]/);
  assert.match(viewSource, /\['2024\/11\/01', '23:00'.+, 2, 0, '1851972681962525075'\]/);
  assert.match(viewSource, /\['2024\/12\/30', '22:30'.+, 6, 0, '1872628541235560835'\]/);
  assert.doesNotMatch(viewSource, /BUDDIESチャンネル|Buddiesチャンネル|Ohisamaチャンネル|imp714p/);
});

test('expanded collaboration history includes Sakamichi joint events and Keyaki Derby', () => {
  assert.match(viewSource, /\['2025\/07\/19', '23:00', '#坂道Stationhead DAY1', 9, 2, '1942191880726528064'\]/);
  assert.match(viewSource, /\['2025\/07\/20', '21:00', '#坂道Stationhead DAY2', 0, 2, '1942191880726528064'\]/);
  assert.match(viewSource, /\['2025\/07\/21', '22:00', '#坂道Stationhead DAY3', 6, 2, '1942191880726528064'\]/);
  assert.match(viewSource, /\['2025\/12\/05', '21:00', 'Buddies × U:nity Stationhead コラボリスニングパーティー'/);
  assert.match(viewSource, /\['2026\/01\/23', '22:00', '日向坂46 × 櫻坂46 #ケヤキダービー'/);
  assert.doesNotMatch(viewSource, /妄想W-KEYAKI FES\.2026/);
});

test('all remaining rows build X announcement URLs from compact account and status metadata', () => {
  assert.equal(eventRows.length, 22);
  assert.match(viewSource, /X_ACCOUNTS = Object\.freeze\(\['skr_Stationhead', 'saku_saka46', 'HNZ_Stationhead', 'ohisama_discord'\]\)/);
  assert.match(viewSource, /source: `https:\/\/x\.com\/\$\{X_ACCOUNTS\[accountIndex\]\}\/status\/\$\{statusId\}`/);
  assert.doesNotMatch(viewSource, /note\.com|sourceLabel|告知記事/);
  assert.match(viewSource, /sourceLink\.textContent = 'X告知'/);
  assert.match(viewSource, /sourceLink\.target = '_blank'/);
  assert.match(viewSource, /sourceLink\.rel = 'noopener noreferrer'/);
});

test('unofficial list is visible only while リスパ is active and legacy route is normalized', () => {
  assert.match(viewSource, /querySelector\('#modeTabs \[data-mode="broadcasts"\]'\)/);
  assert.match(viewSource, /TAB_LABEL = 'リスパ'/);
  assert.match(viewSource, /panel\.hidden = !tab\.classList\.contains\('active'\)/);
  assert.match(viewSource, /new MutationObserver\(syncTab\)/);
  assert.match(viewSource, /location\.hash !== '#unofficial'/);
  assert.match(legacyRoute, /location\.hash === '#unofficial'/);
  assert.match(legacyRoute, /#broadcasts/);
});

test('unofficial data stays out of initial entry and loads only through broadcasts history runtime', () => {
  assert.doesNotMatch(metricsSource, /import '.\/unofficial-listening-parties\.js/);
  assert.match(historyEntry, /unofficial-listening-parties\.js/);
});