import assert from 'node:assert/strict';
import test from 'node:test';

import { saveLeanQueue } from '../functions/lib/d1-optimized-ingest.js';
import { FakeD1Database } from './helpers/fake-d1.js';

test('structural queue changes prune removed items and stale current likes', async () => {
  const db = new FakeD1Database();
  const result = await saveLeanQueue(db, 1_751_500_500_000, {
    type: 'queue',
    collector_id: 'integration-collector',
    data: {
      station_id: 3328626,
      queue_id: 91,
      start_time: 1_751_500_000_000,
      is_paused: false,
      tracks: [{
        position: 0,
        queue_track_id: 100,
        spotify_id: 'spotify-1',
        duration_ms: 180_000,
        bite_count: 12,
      }],
    },
  });

  assert.equal(result.structureChanged, true);
  assert.equal(db.callsMatching(/DELETE FROM sh_queue_items/, 'run').length, 1);
  assert.equal(db.callsMatching(/DELETE FROM sh_track_like_current/, 'run').length, 1);
});
