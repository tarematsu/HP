import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const player = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url), 'utf8');
const webviewPolicy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');
const messagePolicy = readFileSync(
  new URL('../../native/src/sh_stats_webview_message_policy_fix.h', import.meta.url), 'utf8');
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');

test('sh.cpp receives the PR48 stats generator through its actual PCH path', () => {
  assert.match(
    cmake,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_playback_resource_policy_fix\.h/,
  );
  assert.doesNotMatch(player, /#include "sh_track_boundary_script\.h"/);
  assert.match(player, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
  assert.match(
    activePolicy,
    /#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript/,
  );
});

test('Window A waits for the page-observed Authorization header like PR48', () => {
  assert.match(activePolicy, /const headers = window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /error: 'no-auth-header'/);
  assert.match(activePolicy, /credentials: 'include'/);
  assert.match(
    activePolicy,
    /headers: Object\.assign\(\{ accept: 'application\/json' \}, headers\)/,
  );
  assert.doesNotMatch(activePolicy, /const requestHeaders = \{ accept: 'application\/json' \}/);
});

test('successful authenticated polling has the PR48 ten-minute quiet period', () => {
  assert.match(activePolicy, /__homepanelStationheadPlayStatsSuccessAt \|\| 0/);
  assert.match(activePolicy, /Date\.now\(\) - lastSuccessAt < 10 \* 60 \* 1000/);
  assert.match(activePolicy, /__homepanelStationheadPlayStatsSuccessAt = Date\.now\(\)/);
});

test('401 and 403 both invalidate the captured Authorization like PR48', () => {
  const rejectedAt = activePolicy.indexOf(
    'if (response.status === 401 || response.status === 403) {',
  );
  assert.ok(rejectedAt >= 0);
  const rejected = activePolicy.slice(
    rejectedAt,
    activePolicy.indexOf('if (!response.ok)', rejectedAt),
  );
  assert.match(rejected, /__homepanelStationheadRejectedAuthorization = headers\.authorization/);
  assert.match(rejected, /__homepanelStationheadAuthHeaders = null/);
  assert.match(rejected, /stationhead-play-stats-auth-failed/);
  assert.doesNotMatch(rejected, /error: 'forbidden'/);
});

test('successful stats return to StationheadStatus instead of being consumed by NativeStatsStore', () => {
  assert.match(webviewPolicy, /StationheadJuly19AuthCaptureScript/);
  assert.match(webviewPolicy, /stationhead-stats-document/);
  assert.match(webviewPolicy, /auth_generation: 1/);
  assert.match(activePolicy, /request_id: requestId/);
  assert.match(activePolicy, /document_generation: 1/);
  assert.match(activePolicy, /auth_generation: 1/);
  assert.doesNotMatch(messagePolicy, /PublishStationheadNativeStatsMessage/);
  assert.match(webview, /status_\.dailyPlayCounts = std::move\(normalized\)/);
  assert.match(webview, /status_\.dailyPlayStatsUpdatedAt = receivedAt/);
  assert.match(webview, /PostChange\(\)/);
});
