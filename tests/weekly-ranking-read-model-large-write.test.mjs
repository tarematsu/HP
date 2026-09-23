import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeeklyRankingReadModel } from '../worker/scripts/materialize-weekly-ranking-read-model.mjs';

test('weekly ranking read model can grow well beyond a safe argv-sized payload', () => {
  const rankingRows = [];
  for (let week = 0; week < 40; week += 1) {
    const date = new Date(Date.UTC(2026, 0, 5 + week * 7)).toISOString().slice(0, 10);
    for (let host = 0; host < 100; host += 1) {
      rankingRows.push({
        ranking_date: date,
        observed_at: Date.parse(`${date}T00:00:00Z`),
        ranking_type: '週間リーダーボード',
        rank: host + 1,
        host_name: `host-${host}`,
        host_alias: `Host ${host}`,
        source_sheet: 'weekly',
        quality_score: 1,
        quality_flags: null,
      });
    }
  }
  const model = buildWeeklyRankingReadModel(rankingRows, [], [], Date.UTC(2026, 9, 1));
  const payload = JSON.stringify(model);
  assert.ok(Buffer.byteLength(payload, 'utf8') > 64 * 1024);
  assert.equal(model.actual_rows.length, 4000);
});
