import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReadModelForWrite } from '../src/read-model-stages.js';

const READ_MODEL = {
  channel: { channel_id: 10, observed_at: 123_456, presentation: {} },
  queue: {
    station_id: 5,
    queue_id: 9,
    start_time: 100,
    is_paused: false,
    value: {
      tracks: [{
        position: 0,
        spotify_id: 'sp1',
        title: null,
        artist: null,
        album_name: null,
        thumbnail_url: null,
      }],
    },
  },
  collector: { collector_id: 'cloudflare-worker', updated_at: 123_456 },
};

test('previous queue metadata is reused before querying track metadata tables', async () => {
  let previousReads = 0;
  let metadataQueries = 0;
  const MINUTE_DB = {
    prepare(sql) {
      if (/FROM sh_queue_read_model_current/.test(sql)) {
        previousReads += 1;
        return {
          bind() { return this; },
          async first() {
            return {
              queue_id: 9,
              start_time: 100,
              queue_json: JSON.stringify({
                tracks: [{
                  position: 0,
                  spotify_id: 'sp1',
                  title: 'Previous Song',
                  artist: 'Previous Artist',
                  album_name: 'Previous Album',
                  thumbnail_url: 'previous-cover',
                }],
              }),
            };
          },
        };
      }
      metadataQueries += 1;
      return {
        bind() { return this; },
        async all() { return { results: [] }; },
      };
    },
  };
  const BUDDIES_DB = {
    prepare() {
      metadataQueries += 1;
      return {
        bind() { return this; },
        async all() { return { results: [] }; },
      };
    },
  };

  const prepared = await prepareReadModelForWrite({ MINUTE_DB, BUDDIES_DB }, READ_MODEL);

  assert.equal(previousReads, 1);
  assert.equal(metadataQueries, 0);
  assert.deepEqual(prepared.queue.value.tracks[0], {
    position: 0,
    spotify_id: 'sp1',
    title: 'Previous Song',
    artist: 'Previous Artist',
    album_name: 'Previous Album',
    thumbnail_url: 'previous-cover',
  });
});
