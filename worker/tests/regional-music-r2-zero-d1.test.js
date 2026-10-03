import assert from 'node:assert/strict';
import test from 'node:test';

import { publishRegionalMusicServiceReadModel } from '../src/regional-music-read-model.js';
import { regionalSnapshotKey } from '../src/regional-music-r2-snapshot.js';

test('regional publication uses latest R2 snapshot without loading D1', async () => {
  const service = 'bugs';
  const latestKey = regionalSnapshotKey(service);
  const snapshot = {
    version: 1,
    service,
    day: '2026-10-03',
    updated_at: 1234,
    authoritative_fields: [
      'artists',
      'tracks',
      'releases',
      'playlists',
      'playlist_memberships',
      'artist_track_orders',
    ],
    artists: [{
      service,
      canonical_artist: 'sakurazaka46',
      service_artist_id: 'artist-1',
      display_name: '櫻坂46',
      observed_at: 1200,
      followers: 10,
    }],
    tracks: [{
      service,
      service_track_id: 'track-1',
      canonical_artist: 'sakurazaka46',
      track_id: 42,
      canonical_track_id: 42,
      title: 'Song',
      observed_at: 1210,
    }],
    releases: [],
    playlists: [],
    playlist_memberships: [],
    artist_track_orders: [],
    state: {
      service,
      status: 'ok',
      last_attempt_at: 1234,
      last_success_at: 1234,
      updated_at: 1234,
      entity_counts: { artists: 1, tracks: 1 },
    },
  };

  const writes = [];
  let d1Loads = 0;
  const result = await publishRegionalMusicServiceReadModel({
    OTHER_DB: {
      prepare() {
        throw new Error('D1 must not be read when an R2 snapshot exists');
      },
    },
    PAGES_RESPONSE_R2: {
      async get(key) {
        if (key === latestKey) return { async json() { return structuredClone(snapshot); } };
        return null;
      },
      async put() {},
    },
  }, service, 2000, {
    loadReadModel: async () => {
      d1Loads += 1;
      throw new Error('legacy D1 read-model loader must not run');
    },
    saveR2Response: async (_r2, key, body) => {
      writes.push({ key, body: JSON.parse(body) });
      return { storage: 'r2', bytes: body.length };
    },
  });

  assert.equal(d1Loads, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, 'regional-music:bugs');
  assert.equal(writes[0].body.source_updated_at, 1234);
  assert.equal(writes[0].body.tracks[0].track_id, 42);
  assert.equal(writes[0].body.services[0].storage, 'r2');
  assert.equal(result.skipped, false);
});

test('regional publication keeps D1 compatibility fallback when latest R2 snapshot is missing', async () => {
  let d1Loads = 0;
  const writes = [];
  await publishRegionalMusicServiceReadModel({
    OTHER_DB: {},
    PAGES_RESPONSE_R2: {
      async get() { return null; },
      async put() {},
    },
  }, 'bugs', 2000, {
    loadReadModel: async () => {
      d1Loads += 1;
      return {
        artists: [{ service: 'bugs', canonical_artist: 'sakurazaka46', observed_at: 1000 }],
        tracks: [],
        releases: [],
        playlists: [],
        memberships: [],
        artistTrackOrders: [],
        services: [{ service: 'bugs', status: 'ok', updated_at: 1000, entity_counts_json: '{}' }],
      };
    },
    saveR2Response: async (_r2, key, body) => {
      writes.push({ key, body: JSON.parse(body) });
      return { storage: 'r2', bytes: body.length };
    },
  });

  assert.equal(d1Loads, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.source_updated_at, 1000);
});
