import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const buddies = readFileSync(new URL('../src/buddies-playback-state.js', import.meta.url), 'utf8');
const ohisama = readFileSync(new URL('../src/ohisama-playback.js', import.meta.url), 'utf8');
const nogizaka = readFileSync(new URL('../src/nogizaka-raw-materializer.js', import.meta.url), 'utf8');
const hostIngest = readFileSync(new URL('../../site/functions/lib/host-ingest.js', import.meta.url), 'utf8');
const otherTables = readFileSync(new URL('../scripts/other-db-tables.mjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../database/other-migrations/068_nogizaka_history_storage_compaction.sql',
  import.meta.url,
), 'utf8');

const redundantPlaybackColumns = /event_key,played_at,period_key,station_id,track_id,track_key,spotify_id,isrc,title,artist,duration_ms,thumbnail_url/;
const compactPlaybackColumns = /event_key,played_at,period_key,station_id,track_id,track_key\s*\n\s*\) VALUES\(\?,\?,\?,\?,\?,\?\)/;

test('Buddies and Ohisama playback events persist canonical identity without duplicate presentation metadata', () => {
  for (const source of [buddies, ohisama]) {
    assert.match(source, compactPlaybackColumns);
    assert.doesNotMatch(source, redundantPlaybackColumns);
  }
});

test('Nogizaka retires the duplicate per-minute queue metadata archive', () => {
  assert.doesNotMatch(nogizaka, /sh_nogizaka46smej_track_metadata|saveTrackMetadataMinute/);
  assert.match(migration, /DROP TABLE IF EXISTS sh_nogizaka46smej_track_metadata/);
  assert.match(otherTables, /OTHER_RETIRED_OBJECTS[\s\S]*'sh_nogizaka46smej_track_metadata'/);
  assert.doesNotMatch(otherTables, /OTHER_REQUIRED_TABLES[\s\S]*'sh_nogizaka46smej_track_metadata'[\s\S]*OTHER_RETIRED_OBJECTS/);
});

test('Nogizaka raw staging retention is bounded and does not scan or delete every minute', () => {
  assert.match(nogizaka, /RAW_RETENTION_MS = 7 \* 24 \* 60 \* 60_000/);
  assert.match(nogizaka, /RAW_PRUNE_INTERVAL_MINUTES = 60/);
  assert.match(nogizaka, /RAW_PRUNE_BATCH = 500/);
  assert.match(nogizaka, /minute % RAW_PRUNE_INTERVAL_MINUTES !== 0/);
  assert.match(nogizaka, /WHERE observed_at<\?[\s\S]*ORDER BY observed_at ASC[\s\S]*LIMIT \?/);
});

test('Nogizaka opts into change-only like hashing without increasing other solo queue churn', () => {
  assert.match(nogizaka, /claim_bite_count_changes: true/);
  assert.match(hostIngest, /bite_count: data\?\.claim_bite_count_changes === true \? num\(track\.bite_count\) : null/);
  assert.match(hostIngest, /dedupeKey: `solo:\$\{num\(data\.session_id\) \?\? 0\}:queue:/);
});

test('existing UTC day key remains unchanged, preserving the JST 09:00 boundary', () => {
  assert.match(buddies, /Math\.floor\(Number\(timestamp\) \/ DAY_MS\) \* DAY_MS/);
  assert.match(ohisama, /Math\.floor\(Number\(timestamp\) \/ DAY_MS\) \* DAY_MS/);
});
