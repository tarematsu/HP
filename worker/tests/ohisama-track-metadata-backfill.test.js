import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/backfill-ohisama-track-metadata.mjs', import.meta.url), 'utf8');

test('Ohisama metadata backfill reads all persisted playback metadata sources', () => {
  assert.match(script, /FROM sh_track_plays/);
  assert.match(script, /FROM sh_track_like_current/);
  assert.match(script, /FROM sh_track_like_observations/);
  assert.match(script, /sh_track_daily_summary,json_each/);
});

test('Ohisama metadata backfill only fills missing canonical fields and guards identity ownership', () => {
  assert.match(script, /title=COALESCE\(title,/);
  assert.match(script, /artist=COALESCE\(artist,/);
  assert.match(script, /spotify_id=COALESCE\(spotify_id,/);
  assert.match(script, /isrc=COALESCE\(isrc,/);
  assert.match(script, /owner_track_id/);
  assert.match(script, /identity_conflict_count/);
  assert.match(script, /WHERE NOT EXISTS\(SELECT 1 FROM sh_track_aliases/);
});

test('Ohisama metadata backfill supports dry-run and explicit apply modes', () => {
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(script, /applied: APPLY/);
  assert.match(script, /before,/);
  assert.match(script, /after,/);
});
