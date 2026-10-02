import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('known Spotify tracks skip repeated metadata persistence but keep playcount and target writes', () => {
  const consumer = readFileSync(new URL('../src/spotify-playcount-consumer.js', import.meta.url), 'utf8');

  assert.match(consumer, /if \(!track\.identity_cached\) \{/);
  assert.match(consumer, /INSERT OR IGNORE INTO sh_spotify_tracks/);
  assert.match(consumer, /INSERT INTO sh_spotify_playcount_candidates/);
  assert.match(consumer, /for \(const artistKey of track\.target_keys\)/);

  const guard = consumer.indexOf('if (!track.identity_cached)');
  const metadata = consumer.indexOf('INSERT OR IGNORE INTO sh_spotify_tracks', guard);
  const candidate = consumer.indexOf('INSERT INTO sh_spotify_playcount_candidates', guard);
  const targets = consumer.indexOf('for (const artistKey of track.target_keys)', guard);
  assert.ok(guard >= 0 && metadata > guard);
  assert.ok(candidate > metadata);
  assert.ok(targets > candidate);
});

test('known Spotify aliases are resolved before expensive identity enrichment', () => {
  const identity = readFileSync(new URL('../src/spotify-track-identity.js', import.meta.url), 'utf8');

  assert.match(identity, /const IDENTITY_SEEN_REFRESH_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(identity, /alias\.songKey === entry\.songKey/);
  assert.match(identity, /identity_cached: identityCached/);

  const aliasRead = identity.indexOf('await readKnownAliases(db, keyedTracks)');
  const stationhead = identity.indexOf('await attachStationheadTrackIds(pending.map');
  assert.ok(aliasRead >= 0 && stationhead > aliasRead);
});
