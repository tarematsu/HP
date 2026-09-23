import assert from 'node:assert/strict';
import test from 'node:test';

import { importLeaderboardArtifact } from '../scripts/import-stationhead-weekly-leaderboard-actions.mjs';

function artifactWithCount(count, digest = `digest-${count}`) {
  const observedAt = Date.parse('2026-09-21T15:30:00Z');
  return {
    version: 1,
    available: true,
    digest,
    records: [{
      observed_at: observedAt,
      source: 'dom',
      page: 'https://www.stationhead.com/leaderboard',
      url: 'https://www.stationhead.com/leaderboard',
      method: 'GET',
      status: 200,
      content_type: 'application/json',
      body: JSON.stringify({
        schema: 2,
        captured_at: observedAt,
        path: '/leaderboard',
        signed_in: true,
        leaderboard_ready: true,
        ranking: Array.from({ length: count }, (_, index) => ({
          rank: index + 1,
          name: `channel${String(index + 1).padStart(3, '0')}`,
          streams: 100_000 - index,
          days: 7,
        })),
      }),
    }],
  };
}

test('incomplete top-100 snapshot never touches Other.db', async () => {
  const db = {
    prepare() {
      throw new Error('incomplete snapshot must not read or write D1');
    },
  };

  const result = await importLeaderboardArtifact(artifactWithCount(90), db, 123);

  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'expected-complete-top-100');
  assert.equal(result.row_count, 90);
  assert.equal(result.ranking_date, '2026-09-21');
});

test('rank gaps are rejected even when 100 rows were captured', async () => {
  const artifact = artifactWithCount(100, 'digest-gap');
  const snapshot = JSON.parse(artifact.records[0].body);
  snapshot.ranking[19].rank = 101;
  artifact.records[0].body = JSON.stringify(snapshot);

  const db = {
    prepare() {
      throw new Error('gapped snapshot must not read or write D1');
    },
  };

  const result = await importLeaderboardArtifact(artifact, db, 123);

  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'expected-complete-top-100');
  assert.equal(result.row_count, 100);
});
