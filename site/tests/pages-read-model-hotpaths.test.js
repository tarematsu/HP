import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');
const tracks = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const dailyTracks = readFileSync(
  new URL('../../database/facts-migrations/053_pages_track_history_daily_read_model.sql', import.meta.url),
  'utf8',
);

test('current history reads a single daily track-count projection row', () => {
  assert.match(current, /FROM sh_pages_track_history_daily_read_model/);
  assert.doesNotMatch(current, /json_extract\(row_json|SUM\(CASE|FROM sh_pages_track_history_read_model/);
  assert.match(dailyTracks, /CREATE TABLE IF NOT EXISTS sh_pages_track_history_daily_read_model/);
  assert.match(dailyTracks, /CREATE TRIGGER trg_pages_track_history_daily_insert/);
  assert.match(dailyTracks, /CREATE TRIGGER trg_pages_track_history_daily_update/);
  assert.match(dailyTracks, /CREATE TRIGGER trg_pages_track_history_daily_delete/);
});

test('track-history public requests proxy only to the R2 materialized service', () => {
  assert.match(tracks, /PAGES_READ_MODEL_SERVICE/);
  assert.match(tracks, /url\.searchParams\.set\('key', TRACK_HISTORY_MODEL_KEY\)/);
  assert.match(tracks, /url\.searchParams\.set\('api', '1'\)/);
  assert.doesNotMatch(tracks, /MINUTE_DB|\.prepare\(|TRACK_RANKING_SQL|TRACK_RANKING_SUMMARY_SQL|sh_track_ranking_current|MAX\(play_date\)|FROM sh_tracks/);
});

