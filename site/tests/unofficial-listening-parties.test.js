import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewSource = await readFile(new URL('../public/unofficial-listening-parties.js', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const metricsSource = await readFile(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const historyEntry = await readFile(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const legacyRoute = await readFile(new URL('../public/legacy-listening-party-route.js', import.meta.url), 'utf8');

test('official and unofficial listening parties share one top-level リスパ tab', () => {
  assert.match(pageSource, /data-mode="broadcasts">リスパ<\/button>/);
  assert.doesNotMatch(pageSource, /data-mode="broadcasts">(?:Listening Party|リスニングパーティ)<\/button>/);
  assert.doesNotMatch(pageSource, /data-view="unofficial"/);
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

test('unofficial list contains collaborations only', () => {
  const rows = [...viewSource.matchAll(/^  \{ date: '[^']+'.+?\},$/gm)].map(([row]) => row);
  assert.equal(rows.length, 22);
  assert.equal(rows.filter((row) => row.includes("type: 'コラボ'")).length, 22);
  assert.equal(rows.filter((row) => row.includes("type: '単独'")).length, 0);
  assert.doesNotMatch(viewSource, /type: '単独'/);
  assert.doesNotMatch(viewSource, /東京ドーム公演セトリ再現|Addiction.+配信記念リスニング/);
});

test('collaboration rows retain formal hosting channel names', () => {
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

test('expanded collaboration history includes Sakamichi joint events and Keyaki Derby', () => {
  assert.match(viewSource, /date: '2025\/07\/19', time: '23:00', name: '#坂道Stationhead DAY1', place: "乃木坂46fan's Stationhead"/);
  assert.match(viewSource, /date: '2025\/07\/20', time: '21:00', name: '#坂道Stationhead DAY2', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/07\/21', time: '22:00', name: '#坂道Stationhead DAY3', place: 'Ohisama CH\.'/);
  assert.match(viewSource, /date: '2025\/12\/05', time: '21:00', name: 'Buddies × U:nity Stationhead コラボリスニングパーティー'/);
  assert.match(viewSource, /date: '2026\/01\/23', time: '22:00', name: '日向坂46 × 櫻坂46 #ケヤキダービー'/);
  assert.doesNotMatch(viewSource, /妄想W-KEYAKI FES\.2026/);
});

test('all remaining rows use X announcements and the unified X label', () => {
  assert.equal((viewSource.match(/source: 'https:\/\/x\.com\//g) || []).length, 22);
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
  assert.match(metricsSource, /legacy-listening-party-route\.js\?v=20260926\.1/);
  assert.ok(metricsSource.indexOf('legacy-listening-party-route.js') < metricsSource.indexOf('dashboard-tabs.js'));
  assert.match(historyEntry, /if \(mode === 'ranking' \|\| mode === 'broadcasts'\) return mode/);
  assert.match(historyEntry, /unofficial-listening-parties\.js\?v=20260927\.1/);
});
