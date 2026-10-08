import assert from 'node:assert/strict';
import test from 'node:test';

import { leaderboardPublication } from '../src/leaderboard-publication.js';
import { publishReadModelR2 } from '../src/read-model-r2.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('leaderboard publishes to its own canonical R2 key independently of followers', async () => {
  const model = {
    version: 3,
    refreshed_at: 1_790_000_000_000,
    source_max_ranking_date: '2026-09-28',
    actual_rows: [{ ranking_date: '2026-09-28', host_name: 'sakuramankai', rank: 1 }],
    completed_rows: [{ ranking_date: '2026-09-28', host_name: 'sakuramankai', rank: 1 }],
    ranking_weeks: ['2026-09-28'],
    weekly_metrics: [],
  };
  const publication = leaderboardPublication(model, model.refreshed_at, {
    source_digest: 'digest-1',
  });
  const writes = [];
  const bucket = {
    async put(key, body, options) {
      writes.push({ key, body, options });
    },
  };

  const result = await publishReadModelR2(bucket, 'leaderboard', publication.body, {
    status: publication.status,
    headers: publication.headers,
    updatedAt: publication.updated_at,
    cadenceSeconds: publication.cadence_seconds,
    metadata: { source_digest: publication.source_digest },
  });

  const leaderboardKey = pagesR2ResponseKey('leaderboard');
  assert.notEqual(leaderboardKey, pagesR2ResponseKey('followers'));
  assert.equal(result.object_key, leaderboardKey);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, leaderboardKey);
  assert.deepEqual(JSON.parse(writes[0].body), model);
  assert.equal(writes[0].options.customMetadata.updated_at, String(model.refreshed_at));
  assert.equal(writes[0].options.customMetadata.cadence_seconds, String(7 * 24 * 60 * 60));
  assert.equal(writes[0].options.customMetadata.source_digest, 'digest-1');
});
