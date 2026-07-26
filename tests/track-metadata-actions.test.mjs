import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/run-track-metadata-repair.yml', root), 'utf8');
const script = readFileSync(new URL('worker/scripts/repair-track-metadata-actions.mjs', root), 'utf8');
const committed = readFileSync(new URL('worker/src/committed-metadata-enrichment.js', root), 'utf8');

test('track metadata backlog repair runs on a bounded Actions runner', () => {
  assert.match(workflow, /cron: '12,42 \* \* \* \*'/);
  assert.match(workflow, /concurrency:[\s\S]*group: track-metadata-repair[\s\S]*cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /node scripts\/repair-track-metadata-actions\.mjs/);
  assert.match(workflow, /TRACK_METADATA_ACTIONS_LIMIT: '150'/);
});

test('Actions repair reads a bounded latest-state candidate window instead of grouping occurrence history', () => {
  assert.match(script, /candidateScanLimit = Math\.min\(2_000, Math\.max\(candidateLimit, candidateLimit \* 4\)\)/);
  assert.match(script, /FROM sh_track_like_current INDEXED BY idx_sh_track_like_current_observed/);
  assert.match(script, /ORDER BY observed_at DESC LIMIT \$\{candidateScanLimit\}/);
  assert.match(script, /bySpotify\.has\(spotifyId\)/);
  assert.doesNotMatch(script, /FROM sh_queue_items[\s\S]*GROUP BY spotify_id/);
});

test('Actions repair prefers existing buddies metadata before bounded Spotify fetches', () => {
  assert.match(script, /existingRows\(ids, buddiesDatabase\)/);
  assert.match(script, /spotify_oembed_actions/);
  assert.match(script, /TRACK_METADATA_FETCH_CONCURRENCY/);
  assert.match(script, /TRACK_METADATA_REFRESH_MS/);
  assert.match(script, /ON CONFLICT\(spotify_id\) DO UPDATE/);
});

test('Actions repair refreshes current playback read models and records a checkpoint', () => {
  assert.match(script, /sh_queue_read_model_current/);
  assert.match(script, /hydrateQueue/);
  assert.match(script, /task_name,last_started_at,last_success_at/);
  assert.match(script, /'metadata-repair'/);
});

test('Worker playback repair no longer imports the removed sync pipeline', () => {
  assert.match(committed, /playback-read-model-repair\.js/);
  assert.doesNotMatch(committed, /buddies-facts-sync\.js/);
});
