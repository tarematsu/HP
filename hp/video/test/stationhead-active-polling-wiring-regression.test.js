import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmake = readFileSync(new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const player = readFileSync(new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const webview = readFileSync(new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');
const latePolicy = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);

test('periodic stats call and late WebView-only policy live in different translation units', () => {
  assert.match(player, /StationheadPlayer::PollDailyPlayStats/);
  assert.match(player, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
  assert.doesNotMatch(player, /sh_track_boundary_script\.h/);

  assert.match(webview, /#include "sh_track_boundary_script\.h"/);
  assert.match(latePolicy, /#include "sh_july19_stats_policy_fix\.h"/);
});

test('the PCH-visible policy selects the generator used by sh.cpp', () => {
  assert.match(
    cmake,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_playback_resource_policy_fix\.h/,
  );
  assert.match(
    playbackPolicy,
    /#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript/,
  );
  assert.match(playbackPolicy, /credentials: 'include'/);
  assert.match(playbackPolicy, /error: 'no-auth-header'/);
});
