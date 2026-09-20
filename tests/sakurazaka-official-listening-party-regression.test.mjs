import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SAKURAZAKA_MINUTE_SERIES_SQL } from '../site/functions/api/sakurazaka46jp.js';

test('official listening party series includes sparse host overrides without duplicate facts', () => {
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /c\.host_id_override=h\.id/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /f\.broadcast_session_id IS NULL/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /\bf\.host_id\b/);
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /SELECT f\.id AS fact_id[\s\S]*?UNION[\s\S]*?SELECT f\.id AS fact_id/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /UNION ALL/);
});

test('Pages labels official Stationhead events as official listening parties', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-broadcasts.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /button\.textContent = '公式リスパ'/);
  assert.match(source, /tableTitle\.textContent = '公式リスパ一覧'/);
  assert.match(source, /公式リスパ 同接推移/);
  assert.match(source, /CACHE_REVISION = '6'/);
  assert.match(source, /sakurazaka46jp:v1:r\$\{CACHE_REVISION\}:/);
});

test('live screenshot audit requires all six historical official listening party series', () => {
  const source = readFileSync(
    new URL('../scripts/audit-pages-live.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /requiredText: '公式リスパ一覧'/);
  assert.match(source, /legendSelector: '#chartLegend span'/);
  assert.match(source, /minLegendItems: 6/);
});
