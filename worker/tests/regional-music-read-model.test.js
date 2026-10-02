import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadRegionalMusicReadModel,
  REGIONAL_MUSIC_READ_MODEL_KEY,
  publishRegionalMusicReadModel,
  regionalMusicReadModelPayload,
} from '../src/regional-music-read-model.js';

test('regional music read model normalizes collector health and implemented service metadata', () => {
  const payload = regionalMusicReadModelPayload({
    artists: [{ service: 'joox', canonical_artist: 'sakurazaka46', followers: 478 }],
    tracks: [],
    releases: [],
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
  assert.deepEqual(payload.releases, []);
  assert.deepEqual(payload.services[0].entity_counts, { artists: 3 });
  assert.equal(payload.services[0].region, 'HK/TH/SEA');
  assert.equal(payload.services[0].phase, 1);
  assert.deepEqual(payload.services[0].metrics, ['artist_followers']);
  assert.deepEqual(payload.services[1].entity_counts, {});
  assert.equal(payload.services[1].region, null);
  assert.equal(payload.services[1].phase, null);
  assert.deepEqual(payload.services[1].metrics, []);
});

test('regional read model includes complete Kugou Japan chart seed and coverage boundary', () => {
  const payload = regionalMusicReadModelPayload({}, 456);
  const history = payload.kugou_japan_chart.history;
  const counts = history.reduce((map, item) => map.set(item.canonical_artist, (map.get(item.canonical_artist) || 0) + 1), new Map());
  const best = (artist) => Math.min(...history.filter((item) => item.canonical_artist === artist).map((item) => item.rank));

  assert.equal(history.length, 115);
  assert.equal(payload.kugou_japan_chart.coverage.oldest_available, '2024-10-31 10:10:01');
  assert.equal(payload.kugou_japan_chart.coverage.latest_available, '2026-09-30 10:10:01');
  assert.equal(counts.get('sakurazaka46'), 53);
  assert.equal(counts.get('nogizaka46'), 56);
  assert.equal(counts.get('hinatazaka46'), 6);
  assert.equal(best('sakurazaka46'), 19);
  assert.equal(best('nogizaka46'), 2);
  assert.equal(best('hinatazaka46'), 8);
});

test('YouTube Music collector metadata exposes free public metrics without account-only fields', () => {
  const payload = regionalMusicReadModelPayload({
    artists: [{
      service: 'youtube_music',
      canonical_artist: 'sakurazaka46',
      followers: 100,
      monthly_audience: 200,
      total_views: 300,
    }],
    tracks: [],
    releases: [{ service: 'youtube_music', service_release_id: 'MPRE-test' }],
    playlists: [],
    memberships: [],
    services: [{ service: 'youtube_music', status: 'ok', entity_counts_json: '{}' }],
  }, 456);

  assert.equal(payload.artists[0].monthly_audience, 200);
  assert.equal(payload.artists[0].total_views, 300);
  assert.equal(payload.releases.length, 1);
  assert.deepEqual(payload.services[0].metrics, [
    'artist_followers',
    'monthly_audience',
    'total_views',
    'catalog',
    'releases',
    'playlists',
  ]);
});

test('playlist membership query follows the latest playlist snapshot, including an empty snapshot', async () => {
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return { async all() { return { results: [] }; } };
    },
  };

  const snapshot = await loadRegionalMusicReadModel(db);
  assert.deepEqual(snapshot.memberships, []);
  assert.deepEqual(snapshot.releases, []);
  const membershipQuery = queries.find((sql) => sql.includes('regional_music_playlist_memberships AS m'));
  assert.ok(membershipQuery);
  assert.match(membershipQuery, /regional_music_playlist_snapshots AS s/);
  assert.match(membershipQuery, /MAX\(x\.snapshot_date\)/);
  assert.ok(queries.some((sql) => sql.includes('regional_music_releases')));
  assert.ok(queries.some((sql) => sql.includes('monthly_audience')));
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
      releases: [{ service: 'youtube_music' }],
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
  assert.equal(writes[0].body.releases.length, 1);
  assert.equal(writes[0].body.playlist_memberships.length, 1);
  assert.equal(writes[0].body.kugou_japan_chart.history.length, 115);
  assert.deepEqual(writes[0].body.services[0].metrics, ['artist_likes']);
  assert.deepEqual(result, {
    storage: 'r2',
    bytes: writes[0].body ? JSON.stringify(writes[0].body).length : 0,
    artists: 1,
    tracks: 1,
    releases: 1,
    playlists: 1,
    playlist_memberships: 1,
    services: 1,
    kugou_japan_chart_entries: 115,
  });
});
