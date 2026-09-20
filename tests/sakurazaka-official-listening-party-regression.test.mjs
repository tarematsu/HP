import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  appendSakurazakaSummaryPlaceholders,
  SAKURAZAKA_EVENT_SQL,
  SAKURAZAKA_MINUTE_SERIES_SQL,
  trimSakurazakaSeries,
  validateSakurazakaHistoricalSeries,
} from '../site/functions/api/sakurazaka46jp.js';

const ROCK_IN_EVENT = '2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';
const ROCK_IN_START = 1789958700000;

test('official listening party series includes sparse host overrides without duplicate facts', () => {
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /c\.host_id_override=h\.id/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /f\.broadcast_session_id IS NULL/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /\bf\.host_id\b/);
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /SELECT f\.id AS fact_id[\s\S]*?UNION[\s\S]*?SELECT f\.id AS fact_id/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /UNION ALL/);
});

test('official event query includes aggregate listener evidence for series validation', () => {
  assert.match(SAKURAZAKA_EVENT_SQL, /listener_avg/);
  assert.match(SAKURAZAKA_EVENT_SQL, /listener_max/);
});

test('grossly inconsistent historical minute series are removed instead of graphed', () => {
  const [invalid] = validateSakurazakaHistoricalSeries([{
    event_name: '2024.11.22 event',
    started_at: 1732273200000,
    expectedListenerAverage: 542,
    expectedListenerMaximum: 652,
    samples: [
      { elapsed: 0, listener: 110, sourceSamples: 1 },
      { elapsed: 1, listener: 85, sourceSamples: 1 },
      { elapsed: 2, listener: 70, sourceSamples: 1 },
    ],
    source: 'historical_import',
  }]);
  assert.deepEqual(invalid.samples, []);
  assert.equal(invalid.source, 'historical_summary_only');
  assert.equal(invalid.sourceMismatch, true);

  const [valid] = validateSakurazakaHistoricalSeries([{
    event_name: 'valid event',
    started_at: 1,
    expectedListenerAverage: 800,
    expectedListenerMaximum: 900,
    samples: [
      { elapsed: 0, listener: 760, sourceSamples: 1 },
      { elapsed: 1, listener: 820, sourceSamples: 1 },
      { elapsed: 2, listener: 895, sourceSamples: 1 },
    ],
    source: 'historical_import',
  }]);
  assert.equal(valid.samples.length, 3);
  assert.equal(valid.source, 'historical_import');
});

test('pending ROCK IN listening party stays visible without samples and keeps its label when samples arrive', () => {
  const pending = {
    event_name: ROCK_IN_EVENT,
    started_at: ROCK_IN_START,
    samples: [],
    source: 'historical_import',
  };
  const pendingOnly = trimSakurazakaSeries(
    appendSakurazakaSummaryPlaceholders([], [pending]),
  );
  assert.deepEqual(pendingOnly.series, [{
    event_name: ROCK_IN_EVENT,
    started_at: ROCK_IN_START,
    points: [],
    source: 'historical_import',
    source_mismatch: false,
  }]);

  const live = {
    event_name: 'ROCK IN JAPAN FESTIVAL 2026 セットリストのStationheadリスニングパーティー',
    started_at: ROCK_IN_START + 60_000,
    samples: [{ elapsed: 0, listener: 120, sourceSamples: 1 }],
    source: 'official_news_fail_safe',
  };
  const replaced = appendSakurazakaSummaryPlaceholders([live], [pending]);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].event_name, ROCK_IN_EVENT);
  assert.equal(replaced[0].samples.length, 1);
});

test('Pages labels official Stationhead events as official listening parties', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-broadcasts.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /button\.textContent = '公式リスパ'/);
  assert.match(source, /tableTitle\.textContent = '公式リスパ一覧'/);
  assert.match(source, /公式リスパ 同接推移/);
  assert.match(source, /CACHE_REVISION = '8'/);
  assert.match(source, /sakurazaka46jp:v1:r\$\{CACHE_REVISION\}:/);
  assert.match(source, /DATE_PREFIX/);
  assert.match(source, /集計値のみ/);
  assert.match(source, /データ未取得/);
});

test('live screenshot audit retains the historical six-series floor', () => {
  const source = readFileSync(
    new URL('../scripts/audit-pages-live.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /requiredText: '公式リスパ一覧'/);
  assert.match(source, /legendSelector: '#chartLegend span'/);
  assert.match(source, /minLegendItems: 6/);
});