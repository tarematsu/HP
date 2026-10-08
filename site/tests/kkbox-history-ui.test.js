import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/kkbox-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/kkbox.js', import.meta.url), 'utf8');

test('KKBOX owns its chart history layout as a first-class music service', () => {
  assert.match(shell, /viewId: 'kkboxView'/);
  assert.match(shell, /KKBOX 日語チャート グループ別最高順位推移/);
  assert.match(shell, /kkboxJapaneseRankChart/);
  assert.match(shell, /kkboxJapaneseRankLegend/);
  assert.match(shell, /dataAttribute: 'kkbox-territory-filter'/);
  assert.match(shell, /dataAttribute: 'kkbox-period-filter'/);
  assert.match(shell, /dataAttribute: 'kkbox-chart-filter'/);
  assert.match(shell, /KKBOX 日語チャート ランクイン履歴/);
  assert.match(shell, /kkboxJapaneseHistoryBody/);
  assert.match(shell, /headers: \['更新日', 'グループ', '順位', '曲名'\]/);
  assert.match(shell, /dataAttribute: 'kkbox-artist-filter'/);
  assert.doesNotMatch(shell, /regional/i);

  assert.match(runtime, /renderRankHistoryChart/);
  assert.match(runtime, /payload\?\.kkbox_japanese_chart/);
  assert.match(runtime, /activeTerritory = 'tw'/);
  assert.match(runtime, /activePeriodType = 'weekly'/);
  assert.match(runtime, /activeChartType = 'newrelease'/);
  assert.match(runtime, /OUT_OF_CHART_RANK = 101/);
  assert.match(runtime, /CHART_START_DATE = '2020-10-01'/);
  assert.match(runtime, /date >= CHART_START_DATE/);
  assert.match(runtime, /const ordered = history\s*\.filter\(seriesSelected\)\s*\.filter\(artistVisible\)/);
  assert.doesNotMatch(runtime, /keyakizaka46/);
  assert.doesNotMatch(runtime, /hiragana_keyakizaka46/);
  assert.match(runtime, /loadMusicServiceReadModel\(SERVICE\)/);
  assert.match(runtime, /export async function loadKkboxView/);
  assert.doesNotMatch(runtime, /location\.hash|hashchange|popstate|regional/i);
});
