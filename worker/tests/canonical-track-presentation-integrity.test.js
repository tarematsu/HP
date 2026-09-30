import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { compactCollectedQueue } from '../src/collected-track-metadata.js';
import { metadataNeedsRefresh } from '../src/track-metadata.js';
import { readModelMetadataTask } from '../src/read-model-metadata-plan.js';
import { loadReadModelTrackMetadata } from '../src/read-model-metadata-indexed.js';
import { attachPlaybackReadModelTrackMetadata } from '../src/read-model-stationhead-metadata.js';

const migration = readFileSync(
  new URL('../../database/facts-migrations/067_canonical_track_presentation_integrity.sql', import.meta.url),
  'utf8',
);
const repairSource = readFileSync(
  new URL('../src/playback-read-model-repair.js', import.meta.url),
  'utf8',
);
const factsDescriptor = JSON.parse(readFileSync(
  new URL('../../database/facts-db.json', import.meta.url),
  'utf8',
));

test('artwork is required before Spotify presentation metadata is considered complete', () => {
  assert.equal(metadataNeedsRefresh({
    title: 'Song',
    artist: 'Artist',
    thumbnail_url: null,
    fetched_at: 0,
  }, 'spotify-id', 1000), true);
  assert.equal(metadataNeedsRefresh({
    title: 'Song',
    artist: 'Artist',
    thumbnail_url: 'https://example.test/cover.jpg',
    fetched_at: 1,
  }, 'spotify-id', 1000), false);
});

test('track_id alone is a valid hydration lookup for incomplete queue rows', () => {
  assert.equal(readModelMetadataTask({
    queue: {
      value: {
        tracks: [{ track_id: 42, title: null, artist: null, thumbnail_url: null }],
      },
    },
  }), 'read-model-hydration');
});

test('canonical metadata loader queries directly by track_id', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              calls.push({ sql, bindings });
              if (sql.includes('WHERE track_id IN')) {
                return { results: [{
                  track_id: 42,
                  spotify_id: 'spotify-42',
                  isrc: null,
                  title: 'Song',
                  artist: 'Artist',
                  thumbnail_url: 'cover',
                  fetched_at: 10,
                }] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };

  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, [], [], [42]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].thumbnail_url, 'cover');
  assert.equal(calls.some((call) => call.sql.includes('WHERE track_id IN') && call.bindings[0] === 42), true);
});

test('playback hydration applies canonical metadata by track_id before provider fallbacks', () => {
  const hydrated = attachPlaybackReadModelTrackMetadata({
    tracks: [{ track_id: 42, position: 0, title: null, artist: null, thumbnail_url: null }],
  }, [{
    track_id: 42,
    title: 'Canonical Song',
    artist: 'Canonical Artist',
    thumbnail_url: 'canonical-cover',
    spotify_id: 'spotify-42',
  }]);

  assert.equal(hydrated.tracks[0].track_id, 42);
  assert.equal(hydrated.tracks[0].title, 'Canonical Song');
  assert.equal(hydrated.tracks[0].artist, 'Canonical Artist');
  assert.equal(hydrated.tracks[0].thumbnail_url, 'canonical-cover');
});

test('identity-poor Stationhead tracks keep provisional display metadata in compact queue', () => {
  const { queue, metadata } = compactCollectedQueue({
    station_id: 1,
    tracks: [{
      position: 0,
      stationhead_track_id: 99,
      spotify_id: null,
      isrc: null,
      title: 'Provisional Song',
      artist: 'Provisional Artist',
      display_title: 'Provisional Song — Provisional Artist',
      thumbnail_url: 'stationhead-cover',
      duration_ms: 180000,
    }],
  });

  assert.equal(metadata.length, 0);
  assert.equal(queue.tracks[0].title, 'Provisional Song');
  assert.equal(queue.tracks[0].artist, 'Provisional Artist');
  assert.equal(queue.tracks[0].thumbnail_url, 'stationhead-cover');
});

test('canonical presentation migration repairs artwork caches and covers Spotify-only tracks', () => {
  assert.match(migration, /UPDATE sh_track_metadata\s+SET fetched_at=0[\s\S]*thumbnail_url IS NULL/);
  assert.match(migration, /UPDATE sh_isrc_metadata\s+SET fetched_at=0[\s\S]*thumbnail_url IS NULL/);
  assert.match(migration, /LEFT JOIN sh_track_metadata AS m/);
  assert.match(migration, /m\.spotify_id=COALESCE/);
  assert.match(migration, /COALESCE\(\s*NULLIF\(TRIM\(d\.thumbnail_url\),''\),\s*NULLIF\(TRIM\(m\.thumbnail_url\),''\)/);
});

test('metadata change repair canonicalizes both live queue and likes status payload', () => {
  assert.match(repairSource, /canonicalizeTrackRows\(db, hydrated\.tracks\)/);
  assert.match(repairSource, /model_key='track-history-status'/);
  assert.match(repairSource, /canonicalizeTrackRows\(db, status\.ranking\)/);
});

test('MINUTE_DB descriptor registers migration 067 as schema tip', () => {
  assert.equal(
    factsDescriptor.schema,
    'database/facts-migrations/067_canonical_track_presentation_integrity.sql',
  );
  assert.equal(
    factsDescriptor.migrations.at(-1),
    'database/facts-migrations/067_canonical_track_presentation_integrity.sql',
  );
});
