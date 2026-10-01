import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGIONAL_MUSIC_READ_MODEL_KEY,
  publishRegionalMusicReadModel,
  regionalMusicReadModelPayload,
} from '../src/regional-music-read-model.js';

test('regional music read model normalizes collector health and service metadata', () => {
  const payload = regionalMusicReadModelPayload({
    artists: [{ service: 'joox', canonical_artist: 'sakurazaka46', followers: 478 }],
    tracks: [],
    playlists: [],
    memberships: [],
    services: [{
      service: 'joox',
      status: 'ok',
      entity_counts_json: '{"artists":3}',
      updated_at: 123,
    }, {
      service: 'broken',
      status: 'degraded',
      entity_counts_json: 'not-json',
    }],
  }, 456);

  assert.equal(payload.ok, true);
  assert.equal(payload.updated_at, 456);
  assert.equal(payload.artists[0].followers, 478);
  assert.deepEqual(payload.services[0].entity_counts, { artists: 3 });
  assert.equal(payload.services[0].region, 'HK/TH/SEA');
  assert.equal(payload.services[0].phase, 1);
  assert.deepEqual(payload.services[0].metrics, [
    'artist_followers', 'catalog', 'rankings', 'comments', 'playlists',
  ]);
  assert.deepEqual(payload.services[1].entity_counts, {});
  assert.equal(payload.services[1].region, null);
  assert.equal(payload.services[1].phase, null);
  assert.deepEqual(payload.services[1].metrics, []);
});

test('regional music publication writes one compact R2 object', async () => {
  const writes = [];
  const result = await publishRegionalMusicReadModel({
    OTHER_DB: {},
    PAGES_RESPONSE_R2: { put() {} },
  }, 1000, {
    loadReadModel: async () => ({
      artists: [{ service: 'bugs' }],
      tracks: [{ service: 'genie' }],
      playlists: [{ service: 'melon' }],
      memberships: [{ service: 'melon' }],
      services: [{ service: 'bugs', status: 'ok', entity_counts_json: '{}' }],
    }),
    saveR2Response: async (_r2, key, body, status, headers, now, cadence) => {
      writes.push({ key, body: JSON.parse(body), status, headers, now, cadence });
      return { storage: 'r2', bytes: body.length };
    },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, REGIONAL_MUSIC_READ_MODEL_KEY);
  assert.equal(writes[0].status, 200);
  assert.equal(writes[0].now, 1000);
  assert.equal(writes[0].cadence, 86400);
  assert.equal(writes[0].body.playlist_memberships.length, 1);
  assert.deepEqual(writes[0].body.services[0].metrics, ['artist_likes', 'catalog', 'playlists']);
  assert.deepEqual(result, {
    storage: 'r2',
    bytes: writes[0].body ? JSON.stringify(writes[0].body).length : 0,
    artists: 1,
    tracks: 1,
    playlists: 1,
    playlist_memberships: 1,
    services: 1,
  });
});
