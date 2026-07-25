import assert from 'node:assert/strict';
import test from 'node:test';

import { collectRawChannel } from '../src/raw-collector-entry.js';

function channelPayload() {
  return {
    id: 10,
    alias: 'buddies',
    current_station_id: 123,
    current_station: {
      id: 123,
      queue: {
        id: 456,
        start_time: 1_784_000_000_000,
        is_paused: false,
        queue_tracks: [{
          id: 11,
          track: {
            id: 22,
            spotify_id: 'track',
            bite_count: 4,
            title: 'Song',
            artist: { name: 'Artist' },
          },
        }],
      },
    },
  };
}

test('internal prepared collection failures reject instead of silently falling back to v2', async () => {
  let ingestCalls = 0;
  await assert.rejects(collectRawChannel({
    CHANNEL_ALIAS: 'buddies',
    COLLECTOR_INLINE_PIPELINE_ENABLED: true,
    DB: {
      prepare() {
        throw new Error('d1 unavailable');
      },
    },
  }, {
    ensureSession: async () => ({
      authToken: 'token',
      deviceUid: 'device',
      tokenExpiresAt: 9_999_999_999_999,
    }),
    fetch: async () => new Response(JSON.stringify(channelPayload()), { status: 200 }),
    async ingestRawCollection() {
      ingestCalls += 1;
    },
  }), (error) => {
    assert.equal(error?.code, 'PREPARED_COLLECTION_FAILED');
    assert.match(error?.message || '', /prepared collection failed at materialize-queue/);
    return true;
  });
  assert.equal(ingestCalls, 0);
});
