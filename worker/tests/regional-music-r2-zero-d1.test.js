import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishRegionalMusicReadModels,
  publishRegionalMusicServiceReadModel,
} from '../src/regional-music-read-model.js';
import { regionalSnapshotKey } from '../src/regional-music-r2-snapshot.js';

function r2Snapshot(service, updatedAt = 1234) {
  return {
    version: 1,
    service,
    day: '2026-10-03',
    updated_at: updatedAt,
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
      observed_at: updatedAt - 20,
      followers: 10,
    }],
    tracks: [{
      service,
      service_track_id: 'track-1',
      canonical_artist: 'sakurazaka46',
      track_id: 42,
      canonical_track_id: 42,
      title: 'Song',
      observed_at: updatedAt - 10,
    }],
    releases: [],
    playlists: [],
    playlist_memberships: [],
    artist_track_orders: [],
    state: {
      service,
      status: 'ok',
      last_attempt_at: updatedAt,
      last_success_at: updatedAt,
      updated_at: updatedAt,
      entity_counts: { artists: 1, tracks: 1 },
    },
  };
}

test('regional publication uses latest R2 snapshot without loading D1', async () => {
  const service = 'bugs';
  const latestKey = regionalSnapshotKey(service);
  const snapshot = r2Snapshot(service);
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

test('mixed publication scopes D1 fallback only to the service missing R2', async () => {
  const snapshots = new Map([
    [regionalSnapshotKey('bugs'), r2Snapshot('bugs', 1500)],
  ]);
  const fallbackCalls = [];
  const writes = [];

  const result = await publishRegionalMusicReadModels({
    OTHER_DB: {},
    PAGES_RESPONSE_R2: {
      async get(key) {
        const value = snapshots.get(key);
        return value ? { async json() { return structuredClone(value); } } : null;
      },
      async put() {},
    },
  }, ['bugs', 'youtube_music'], 2000, {
    loadServiceReadModel: async (_db, service) => {
      fallbackCalls.push(service);
      return {
        artists: [{ service, canonical_artist: 'sakurazaka46', observed_at: 1400 }],
        tracks: [{ service, service_track_id: 'yt-1', observed_at: 1450, plays: 999 }],
        releases: [],
        playlists: [],
        memberships: [],
        artistTrackOrders: [],
        services: [{ service, status: 'ok', updated_at: 1460, entity_counts_json: '{}' }],
      };
    },
    saveR2Response: async (_r2, key, body) => {
      writes.push({ key, body: JSON.parse(body) });
      return { storage: 'r2', bytes: body.length };
    },
  });

  assert.deepEqual(fallbackCalls, ['youtube_music']);
  assert.equal(result.d1_fallback, true);
  assert.deepEqual(result.d1_fallback_services, ['youtube_music']);
  assert.equal(writes.find((row) => row.key === 'regional-music:bugs').body.source_updated_at, 1500);
  assert.equal(writes.find((row) => row.key === 'regional-music:youtube_music').body.tracks[0].plays, 999);
});
