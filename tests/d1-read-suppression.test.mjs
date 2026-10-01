import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const descriptor = JSON.parse(source('database/facts-db.json'));
const cacheMigration = source('database/facts-migrations/072_track_identity_cache.sql');
const identity = source('worker/src/track-title-artist-identity.js');
const metadata = source('worker/src/read-model-metadata-indexed.js');
const canonicalizer = source('site/functions/lib/canonical-track-rows.js');
const amazon = source('worker/src/amazon-music-canonical-metadata.js');
const ranking = source('site/functions/lib/track-ranking.js');
const monthlyApi = source('site/functions/api/spotify-monthly-listeners.js');
const monthlyCollector = source('worker/src/spotify-monthly-listeners.js');

test('identity cache is the MINUTE_DB schema tip and includes negative-cache expiry', () => {
  const path = 'database/facts-migrations/072_track_identity_cache.sql';
  assert.equal(descriptor.schema, path);
  assert.equal(descriptor.migrations.at(-1), path);
  assert.match(cacheMigration, /identity_key TEXT PRIMARY KEY/);
  assert.match(cacheMigration, /unresolved_until INTEGER NOT NULL DEFAULT 0/);
  assert.match(cacheMigration, /WITHOUT ROWID/);
});

test('title identity probes the cache and canonical dictionary before lower priority sources', () => {
  const cache = identity.indexOf('FROM sh_track_identity_cache');
  const dictionary = identity.indexOf("['dictionary', 'metadata', 'tracks', 'isrc']");
  assert.ok(cache >= 0);
  assert.ok(dictionary > cache);
  assert.match(identity, /IDENTITY_NEGATIVE_TTL_MS = 6 \* 60 \* 60_000/);
  assert.match(identity, /IDENTITY_LRU_LIMIT = 1_500/);
  assert.doesNotMatch(identity, /FROM sh_track_canonical_metadata/);
});

test('runtime metadata hotpaths no longer query the canonical UNION view', () => {
  for (const code of [metadata, canonicalizer, amazon, ranking]) {
    assert.doesNotMatch(code, /FROM sh_track_canonical_metadata/);
  }
  assert.match(metadata, /METADATA_LRU_LIMIT = 2_000/);
  assert.match(metadata, /FROM sh_tracks t/);
  assert.match(metadata, /LEFT JOIN sh_track_dictionary d/);
});

test('Spotify monthly listeners are materialized on collection and served as one row', () => {
  assert.match(monthlyCollector, /refreshSpotifyMonthlyListenersReadModel/);
  assert.match(monthlyCollector, /INSERT INTO sh_spotify_monthly_listeners_read_model/);
  assert.match(monthlyApi, /FROM sh_spotify_monthly_listeners_read_model/);
  assert.match(monthlyApi, /LIMIT 1/);
});
