import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const nativeStatsHeaderUrl = new URL(
  '../../native/src/stationhead_native_stats.h', import.meta.url);
const nativeStatsSourceUrl = new URL(
  '../../native/src/stationhead_native_stats.cpp', import.meta.url);
const playbackPolicyUrl = new URL(
  '../../native/src/sh_playback_resource_policy_fix.h', import.meta.url);
const authPolicyUrl = new URL(
  '../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url);
const trackBoundaryUrl = new URL(
  '../../native/src/sh_track_boundary_script.h', import.meta.url);
const playerSourceUrl = new URL('../../native/src/sh.cpp', import.meta.url);
const cmakeUrl = new URL('../../native/CMakeLists.txt', import.meta.url);
const rendererUrl = new URL(
  '../../native/src/renderer_panel_state.cpp', import.meta.url);
const panelUrl = new URL(
  '../../native/src/renderer_panels/media_section_v2.inc', import.meta.url);

const nativeStatsHeader = readFileSync(nativeStatsHeaderUrl, 'utf8');
const nativeStats = readFileSync(nativeStatsSourceUrl, 'utf8');
const playbackPolicy = readFileSync(playbackPolicyUrl, 'utf8');
const authPolicy = readFileSync(authPolicyUrl, 'utf8');
const trackBoundary = readFileSync(trackBoundaryUrl, 'utf8');
const playerSource = readFileSync(playerSourceUrl, 'utf8');
const cmake = readFileSync(cmakeUrl, 'utf8');
const renderer = readFileSync(rendererUrl, 'utf8');
const panel = readFileSync(panelUrl, 'utf8');

const removedPolicies = [
  'sh_stats_session_policy_fix.h',
  'sh_stats_passive_response_policy_fix.h',
  'sh_stats_july26_baseline_policy_fix.h',
  'sh_stats_july23_baseline_policy_fix.h',
  'sh_stats_auth_fallback_policy_fix.h',
  'stationhead_native_stats_policy.h',
];

test('all stacked generated play-count policy files are removed', () => {
  for (const file of removedPolicies) {
    assert.equal(
      existsSync(new URL(`../../native/src/${file}`, import.meta.url)),
      false,
      `${file} must stay deleted`,
    );
  }
  assert.doesNotMatch(authPolicy, /sh_stats_/);
  assert.doesNotMatch(trackBoundary, /sh_stats_/);
  assert.doesNotMatch(cmake, /stationhead_native_stats_policy/);
});

test('a normal C++ source is built and directly attached by WebView setup', () => {
  assert.match(cmake, /src\/stationhead_native_stats\.cpp/);
  assert.doesNotMatch(
    cmake,
    /target_precompile_headers\(HomePanel PRIVATE\s+src\/stationhead_native_stats/,
  );
  assert.match(playbackPolicy, /#include "stationhead_native_stats\.h"/);
  assert.match(
    playbackPolicy,
    /AttachStationheadNativeStats\(webview, config\.channelId\)/,
  );
  assert.match(nativeStatsHeader, /void AttachStationheadNativeStats/);
});

test('the legacy page-generated statistics scheduler remains disabled', () => {
  assert.match(
    nativeStatsHeader,
    /kStationheadLegacyStatsPollDisabledIntervalMs =\s*INT64_MAX \/ 2/,
  );
  assert.match(
    playbackPolicy,
    /#define kStationheadDailyPlayStatsIntervalMs\s*\\\s*::hp::kStationheadLegacyStatsPollDisabledIntervalMs/,
  );
  assert.match(
    playerSource,
    /nowMs - lastDailyPlayStatsAt_ >= kStationheadDailyPlayStatsIntervalMs/,
  );
});

test('one successful account response CDP event seeds the active native worker', () => {
  assert.match(nativeStats, /GetDevToolsProtocolEventReceiver/);
  assert.match(nativeStats, /Network\.responseReceived/);
  assert.match(nativeStats, /get_ParameterObjectAsJson/);
  assert.match(nativeStats, /GetNamedNumber\(L"status", 0\)/);
  assert.match(nativeStats, /status < 200 \|\| status >= 300/);
  assert.match(nativeStats, /IsStationheadAccountApiUri/);
  assert.match(nativeStats, /path\.starts_with\(L"\/me\/"\)/);
  assert.match(nativeStats, /path == L"\/account"/);
  assert.match(nativeStats, /GetNamedObject\(L"requestHeaders"\)/);
  assert.match(nativeStats, /DevToolsHeaderValue\(headers, L"authorization"/);
  assert.match(nativeStats, /StatsClient\(\)\.ObserveCredentials/);
  assert.match(nativeStats, /CallDevToolsProtocolMethod\(L"Network\.enable"/);

  assert.doesNotMatch(nativeStats, /Network\.requestWillBeSent/);
  assert.doesNotMatch(nativeStats, /Network\.loadingFinished/);
  assert.doesNotMatch(nativeStats, /Network\.loadingFailed/);
  assert.doesNotMatch(nativeStats, /Network\.getResponseBody/);
  assert.doesNotMatch(nativeStats, /requestId|PendingRequest/);
  assert.doesNotMatch(nativeStats, /add_WebResourceRequested|add_WebResourceResponseReceived/);
});

test('one worker actively downloads and publishes play counts', () => {
  assert.match(nativeStats, /class NativeStatsClient/);
  assert.match(nativeStats, /std::condition_variable wake_/);
  assert.match(nativeStats, /std::thread\(\[this\] \{ WorkerLoop\(\); \}\)\.detach\(\)/);
  assert.match(nativeStats, /wake_\.wait_until\(lock, nextAttempt_\)/);
  assert.match(nativeStats, /WinHttpDownload\(/);
  assert.match(nativeStats, /L"\/streakStats"/);
  assert.match(nativeStats, /kSuccessInterval/);
  assert.match(nativeStats, /kRetryInterval/);
  assert.match(nativeStats, /ParseStatsJson/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
});

test('credential updates use one generation guard instead of sticky auth state', () => {
  assert.match(nativeStats, /bool operator==\(const RequestCredentials&\) const = default/);
  assert.match(nativeStats, /\+\+credentialsGeneration_/);
  assert.match(nativeStats, /generation = credentialsGeneration_/);
  assert.match(nativeStats, /currentCredentials = generation == credentialsGeneration_/);
  assert.match(nativeStats, /parsed && currentCredentials/);
  assert.doesNotMatch(nativeStats, /replaceCredentials_|authRejected/);
});

test('the active native path does not patch page JavaScript or add request correlation', () => {
  assert.doesNotMatch(nativeStats, /LR"JS|ExecuteScript|postMessage|chrome\?\.webview/);
  assert.doesNotMatch(nativeStats, /document_generation|auth_generation|request_id|requestId/);
  assert.doesNotMatch(nativeStats, /localStorage|sessionStorage/);
  assert.doesNotMatch(nativeStats, /WebResourceRequested|WebResourceResponseReceived/);
});

test('JSON normalization and storage remain implemented in C++', () => {
  assert.match(nativeStats, /JsonObject::Parse/);
  assert.match(nativeStats, /GetNamedArray\(L"chart_data"\)/);
  assert.match(nativeStats, /std::stable_sort/);
  assert.match(nativeStats, /normalized\.back\(\)\.value = point\.value/);
  assert.match(nativeStats, /normalized\.size\(\) > 45/);
  assert.match(nativeStats, /class NativeStatsStore/);
  assert.match(nativeStats, /history_\.push_back/);
  assert.match(nativeStats, /snapshot\.recentHour/);
});

test('renderer directly consumes and observes the native store revision', () => {
  assert.match(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
  assert.match(panel, /SummarizeStationheadDailyPlays\(nativeStats\.daily, nowMs\)/);
  assert.match(renderer, /GlobalStationheadNativeStatsStore\(\)\.Revision\(\)/);
  assert.match(renderer, /nativeStatsChanged/);
  assert.match(renderer, /PanelSection::Music/);
});
