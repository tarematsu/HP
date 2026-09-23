import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReadModelTitleArtistIdentity } from '../src/read-model-title-artist-identity.js';

function db() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('FROM sh_track_dictionary')) {
            return { results: [{
              spotify_id: 'spotify-known',
              isrc: 'JPSR02600001',
              title: 'Known Song',
              artist: 'Known Artist',
              thumbnail_url: 'https://img.example/known.jpg',
              fetched_at: 20,
            }] };
          }
          return { results: [] };
        },
      };
    },
  };
}

test('read model promotes display-derived title and artist into provider identity', async () => {
  const readModel = {
    queue: {
      value: {
        tracks: [{
          position: 0,
          title: 'Known Song',
          artist: 'Known Artist',
          display_title: 'Known Song — Known Artist',
        }],
      },
    },
  };

  const resolved = await resolveReadModelTitleArtistIdentity({ MINUTE_DB: db() }, readModel);
  assert.equal(resolved.queue.value.tracks[0].spotify_id, 'spotify-known');
  assert.equal(resolved.queue.value.tracks[0].isrc, 'JPSR02600001');
  assert.equal(resolved.queue.value.tracks[0].thumbnail_url, 'https://img.example/known.jpg');
  assert.equal(resolved.queue.value.tracks[0].display_title, 'Known Song — Known Artist');
});
