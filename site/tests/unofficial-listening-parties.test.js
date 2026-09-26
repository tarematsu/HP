import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewSource = await readFile(new URL('../public/unofficial-listening-parties.js', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const metricsSource = await readFile(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('official and unofficial listening parties share one top-level tab', () => {
  assert.match(pageSource, /data-mode="broadcasts">リスニングパーティ<\/button>/);
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
  assert.doesNotMatch(viewSource, /<canvas\b/);
  assert.doesNotMatch(viewSource, /chart-panel/);
});

test('unofficial list is visible only while the listening-party tab is active and the tab label stays unified', () => {
  assert.match(viewSource, /querySelector\('#modeTabs \[data-mode="broadcasts"\]'\)/);
  assert.match(viewSource, /TAB_LABEL = 'リスニングパーティ'/);
  assert.match(viewSource, /tab\.textContent !== TAB_LABEL/);
  assert.match(viewSource, /panel\.hidden = !tab\.classList\.contains\('active'\)/);
  assert.match(viewSource, /new MutationObserver\(syncTab\)/);
  assert.match(viewSource, /attributeFilter: \['class', 'aria-current'\]/);
  assert.match(viewSource, /childList: true/);
});

test('legacy unofficial tab and route are normalized into the listening-party view', () => {
  assert.match(viewSource, /querySelector\('#modeTabs \[data-view="unofficial"\]'\)\?\.remove\(\)/);
  assert.match(viewSource, /getElementById\('unofficialView'\)\?\.remove\(\)/);
  assert.match(viewSource, /location\.hash !== '#unofficial'/);
  assert.match(viewSource, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#broadcasts`\)/);
});

test('historical unofficial listening party rows use formal hosting channel names', () => {
  const rows = [...viewSource.matchAll(/\{ date: '[^']+'.+?\},/g)];
  assert.equal(rows.length, 41);
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

test('every historical row is explicitly classified as collaboration or solo', () => {
  const rows = [...viewSource.matchAll(/^  \{ date: '[^']+'.+?\},$/gm)].map(([row]) => row);
  assert.equal(rows.length, 41);
  assert.equal(rows.filter((row) => row.includes("type: 'コラボ'")).length, 22);
  assert.equal(rows.filter((row) => row.includes("type: '単独'")).length, 19);
  assert.match(viewSource, /date: '2024\/07\/03'.+type: '単独'/);
  assert.match(viewSource, /date: '2024\/08\/02'.+type: 'コラボ'/);
  assert.match(viewSource, /date: '2025\/07\/20'.+type: 'コラボ'/);
  assert.match(viewSource, /date: '2025\/04\/18'.+type: '単独'/);
});

test('expanded history includes the three-Sakamichi joint event and Keyaki Derby', () => {
  assert.match(viewSource, /date: '2025\/07\/19', time: '23:00', name: '#坂道Stationhead DAY1', place: "乃木坂46fan's Stationhead"/);
  assert.match(viewSource, /date: '2025\/07\/20', time: '21:00', name: '#坂道Stationhead DAY2', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/07\/21', time: '22:00', name: '#坂道Stationhead DAY3', place: 'Ohisama CH\.'/);
  assert.match(viewSource, /date: '2026\/01\/23', time: '22:00', name: '日向坂46 × 櫻坂46 #ケヤキダービー', place: 'Ohisama CH\.'/);
  assert.doesNotMatch(viewSource, /妄想W-KEYAKI FES\.2026/);
});

test('verified 2025 collaborations include the December 5 U:nity party', () => {
  assert.match(viewSource, /date: '2025\/02\/28', time: '22:00', name: 'SUGA × 櫻坂46 Streaming Party DAY1', place: 'sugaglobalunion'/);
  assert.match(viewSource, /date: '2025\/03\/01', time: '22:00', name: 'SUGA × 櫻坂46 Streaming Party DAY2', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/05\/05', time: '22:00', name: 'WHITE SCORPION × 櫻坂46.+DAY1', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/05\/10', time: '22:00', name: 'WHITE SCORPION × 櫻坂46.+DAY2', place: 'scopist1ch'/);
  assert.match(viewSource, /date: '2025\/05\/24', time: '22:00', name: 'MONSTA X × 櫻坂46.+', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/12\/05', time: '21:00', name: 'Buddies × U:nity Stationhead コラボリスニングパーティー', place: 'BUDDIES STATIONHEAD'/);
});

test('fan-hosted solo broadcasts include live setlists and a release listening session', () => {
  assert.match(viewSource, /date: '2024\/06\/28', time: '23:30頃'.+place: 'sakuramankai'/);
  assert.match(viewSource, /date: '2024\/07\/03', time: '23:30', name: '東京ドーム公演セトリ再現 Streaming Party', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2024\/07\/23', time: '22:00'.+place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2024\/08\/08', time: '未確認', name: '「自業自得」ミニライブ配信セトリ放送', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2024\/11\/22', time: '22:00', name: '3rd YEAR ANNIVERSARY LIVE DAY2 セトリ放送', place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2024\/11\/23', time: '23:30'.+place: 'sakuramankai2'/);
  assert.match(viewSource, /date: '2024\/12\/03', time: '22:30'.+place: 'sakuramankai2'/);
  assert.match(viewSource, /date: '2024\/12\/05', time: '23:00'.+place: 'BUDDIES STATIONHEAD'/);
  assert.match(viewSource, /date: '2025\/04\/18', time: '00:00', name: '「Addiction」配信記念リスニング', place: 'BUDDIES STATIONHEAD'/);
});

test('all historical rows use X announcements and the unified X label', () => {
  assert.equal((viewSource.match(/source: 'https:\/\/x\.com\//g) || []).length, 41);
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

test('unofficial data loads before dashboard tab setup with a fresh deployment version', () => {
  const unofficialImport = metricsSource.indexOf("import './unofficial-listening-parties.js");
  const tabsImport = metricsSource.indexOf("import './dashboard-tabs.js");
  assert.ok(unofficialImport >= 0 && tabsImport > unofficialImport);
  assert.match(metricsSource, /unofficial-listening-parties\.js\?v=20260926\.2/);
  assert.match(pageSource, /dashboard-metrics\.js\?v=20260926\.3/);
});