import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PLAYED_TRACK_STREAMS_SQL } from '../functions/api/played-track-streams.js';

const shell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/played-tracks-stream-composition.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('played tracks view owns the estimated stream composition chart', () => {
  assert.match(shell, /日別推定再生数（曲別）/);
  assert.match(shell, /playedTracksStreamChart/);
  assert.match(shell, /平均同接×再生回数/);
  assert.match(shell, /played-tracks-stream-composition\.js\?v=20260927\.1/);
  assert.doesNotMatch(shell, /data-view="stream|data-view="streams/);
  assert.match(metrics, /played-tracks-shell\.js\?v=20260927\.1/);
});

test('stream composition uses daily stream totals and listener-weighted tracks from September 10', () => {
  assert.match(runtime, /const START = '2026-09-10'/);
  assert.match(runtime, /\/api\/played-track-streams\?from=/);
  assert.match(runtime, /\/api\/history\?mode=daily/);
  assert.match(runtime, /listener_weight/);
  assert.match(runtime, /stream_growth/);
  assert.match(runtime, /fillRect/);
});

test('listener-weight API reuses playback timing and averages listeners during each play', () => {
  assert.match(PLAYED_TRACK_STREAMS_SQL, /start_time>=\? AND start_time<\?/);
  assert.match(PLAYED_TRACK_STREAMS_SQL, /AVG\(snapshots\.listener_count\) AS play_listener_avg/);
  assert.match(PLAYED_TRACK_STREAMS_SQL, /snapshots\.observed_at>=plays\.played_at/);
  assert.match(PLAYED_TRACK_STREAMS_SQL, /AVG\(play_listener_stats\.play_listener_avg\) \* COUNT\(\*\) AS listener_weight/);
});
