import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/enrich-ohisama-track-metadata.mjs', import.meta.url), 'utf8');

test('Ohisama Spotify enrichment targets only tracks already used by Ohisama', () => {
  assert.match(script, /SELECT track_id FROM sh_track_plays/);
  assert.match(script, /SELECT track_id FROM sh_track_like_current/);
  assert.match(script, /SELECT track_id FROM sh_track_like_observations/);
  assert.match(script, /sh_track_daily_summary,json_each/);
  assert.match(script, /id IN \(\$\{part\.join\(','\)\}\)/);
});

test('Ohisama Spotify enrichment reuses shared Spotify metadata resolver', () => {
  assert.match(script, /import \{ fetchTrackMetadata \} from '\.\.\/src\/track-metadata\.js'/);
  assert.match(script, /fetchTrackMetadata\(/);
  assert.match(script, /requestTimeoutMs: 8_000/);
});

test('Ohisama Spotify enrichment fills presentation data without replacing identity', () => {
  assert.match(script, /UPDATE sh_tracks SET\s+title=CASE[\s\S]{0,500}artist=CASE[\s\S]{0,500}WHERE id=\$\{row\.track_id\} AND spotify_id=/);
  assert.match(script, /INSERT INTO sh_track_metadata/);
  assert.match(script, /ON CONFLICT\(spotify_id\) DO UPDATE SET/);
  assert.doesNotMatch(script, /UPDATE sh_tracks SET\s+spotify_id=/);
  assert.doesNotMatch(script, /UPDATE sh_tracks SET\s+isrc=/);
});

test('Ohisama Spotify enrichment repairs local history and daily summaries by canonical track_id', () => {
  assert.match(script, /UPDATE sh_track_plays SET/);
  assert.match(script, /sh_track_like_current/);
  assert.match(script, /sh_track_like_observations/);
  assert.match(script, /UPDATE sh_track_daily_summary SET tracks_json=/);
  assert.match(script, /metadataById\.get\(integer\(track\?\.track_id\)\)/);
});
