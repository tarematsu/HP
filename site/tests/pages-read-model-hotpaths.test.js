import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const boundary = readFileSync(new URL('../functions/lib/period-boundary-evidence.js', import.meta.url), 'utf8');
const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');
const tracks = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const facts = readFileSync(new URL('../functions/lib/dashboard-facts.js', import.meta.url), 'utf8');
const dailyTracks = readFileSync(
  new URL('../../database/facts-migrations/053_pages_track_history_daily_read_model.sql', import.meta.url),
  'utf8',
);

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('history boundary reads never fall back to raw snapshot repair', () => {
  const loader = between(
    boundary,
    'export async function loadPeriodBoundaryEvidence',
    'export function applyPeriodBoundaryEvidence',
  );
  assert.match(loader, /loadPreaggregatedEvidence/);
  assert.doesNotMatch(loader, /periodBoundaryEvidenceSql|sh_channel_snapshots|\.batch\(|INSERT|UPDATE/);
});

test('current history reads a single daily track-count projection row', () => {
  assert.match(current, /FROM sh_pages_track_history_daily_read_model/);
  assert.doesNotMatch(current, /json_extract\(row_json|SUM\(CASE|FROM sh_pages_track_history_read_model/);
  assert.match(dailyTracks, /CREATE TABLE IF NOT EXISTS sh_pages_track_history_daily_read_model/);
  assert.match(dailyTracks, /CREATE TRIGGER trg_pages_track_history_daily_insert/);
  assert.match(dailyTracks, /CREATE TRIGGER trg_pages_track_history_daily_update/);
  assert.match(dailyTracks, /CREATE TRIGGER trg_pages_track_history_daily_delete/);
});

test('likes and latest-date requests read the track-history status payload only', () => {
  assert.match(tracks, /model_key='track-history-status'/);
  assert.doesNotMatch(tracks, /TRACK_RANKING_SQL|TRACK_RANKING_SUMMARY_SQL|sh_track_ranking_current|MAX\(play_date\)|FROM sh_tracks/);
});

test('dashboard request path never calculates the prediction regression', () => {
  const loader = between(facts, 'export async function loadFactsDashboard', 'export async function loadFactsBaseline');
  assert.doesNotMatch(loader, /FACTS_PREDICTION_24H_SQL|predictionStatement/);
  assert.match(loader, /prediction: null/);
});
