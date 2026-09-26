import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/played-tracks-stream-composition.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('played tracks view owns the estimated stream composition chart', () => {
  assert.match(shell, /日別推定再生数（曲別）/);
  assert.match(shell, /playedTracksStreamChart/);
  assert.match(shell, /曲別再生回数の比率で按分/);
  assert.match(shell, /played-tracks-stream-composition\.js\?v=20260927\.1/);
  assert.doesNotMatch(shell, /平均同接/);
  assert.doesNotMatch(shell, /data-view="stream|data-view="streams/);
  assert.match(metrics, /played-tracks-shell\.js\?v=20260927\.1/);
});

test('stream composition allocates daily totals by each tracks share of play count from September 10', () => {
  assert.match(runtime, /const START = '2026-09-10'/);
  assert.match(runtime, /\/api\/track-history\?from=/);
  assert.match(runtime, /limit=20000&ranking=0/);
  assert.match(runtime, /\/api\/history\?mode=daily/);
  assert.match(runtime, /row\.play_count \/ totalPlays/);
  assert.match(runtime, /stream_growth/);
  assert.match(runtime, /fillRect/);
  assert.doesNotMatch(runtime, /listener_weight|listener_avg|played-track-streams/);
});

test('estimated stream chart does not add a dedicated D1-backed API route', () => {
  assert.equal(existsSync(new URL('../functions/api/played-track-streams.js', import.meta.url)), false);
});
