import assert from 'node:assert/strict';
import test from 'node:test';

import { publishStationheadLeaderboardReadModel } from '../scripts/publish-stationhead-leaderboard-read-model.mjs';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('leaderboard publishes to its own Actions R2 key independently of followers', async () => {
  const model = {
    version: 3,
    refreshed_at: 1_790_000_000_000,
    source_max_ranking_date: '2026-09-28',
    actual_rows: [{ ranking_date: '2026-09-28', host_name: 'sakuramankai', rank: 1 }],
    completed_rows: [{ ranking_date: '2026-09-28', host_name: 'sakuramankai', rank: 1 }],
    ranking_weeks: ['2026-09-28'],
    weekly_metrics: [],
  };
  const stored = {
    payload_json: JSON.stringify(model),
    source_max_ranking_date: model.source_max_ranking_date,
    refreshed_at: model.refreshed_at,
  };
  const db = {
    prepare(sql) {
      assert.match(sql, /sh_weekly_ranking_read_model/);
      return { async first() { return stored; } };
    },
  };
  const writes = [];

  const result = await publishStationheadLeaderboardReadModel({
    db,
    upload: (key, payload) => writes.push({ key, payload }),
  });

  const leaderboardKey = pagesR2ResponseKey('leaderboard');
  assert.notEqual(leaderboardKey, pagesR2ResponseKey('followers'));
  assert.equal(result.model_key, 'leaderboard');
  assert.equal(result.object_key, leaderboardKey);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, leaderboardKey);
  assert.equal(writes[0].payload.updated_at, model.refreshed_at);
  assert.equal(writes[0].payload.cadence_seconds, 7 * 24 * 60 * 60);
  assert.deepEqual(JSON.parse(writes[0].payload.body), model);
});
