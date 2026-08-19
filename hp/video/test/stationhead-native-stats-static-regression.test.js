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
  assert.doesNotMatch(playbackPolicy, /StationheadOwnsWorkerRequestFilters\(webview\)/);
  assert.match(
    playbackPolicy,
    /AttachStationheadNativeStats\(webview, config\.channelId\)/,
  );
  assert.match(nativeStatsHeader, /void AttachStationheadNativeStats/);
});

test('the legacy page-generated statistics scheduler is compile-time disabled', () => {
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

test('one committed response observer consumes streakStats directly', () => {
  assert.doesNotMatch(nativeStats, /add_WebResourceRequested/);
  assert.doesNotMatch(nativeStats, /AddWebResourceRequestedFilter/);
  assert.match(nativeStats, /add_WebResourceResponseReceived/);
  assert.match(nativeStats, /get_Request/);
  assert.match(nativeStats, /IsStatsUri\(uri, channelId\)/);
  assert.match(nativeStats, /get_Response\(&response\)/);
  assert.match(nativeStats, /get_StatusCode\(&status\)/);
  assert.match(nativeStats, /response->GetContent\(/);
  assert.match(nativeStats, /ReadBoundedStream\(stream, body\)/);
  assert.match(nativeStats, /ParseStatsJson\(body, receivedAt, daily\)/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish\(std::move\(daily\), receivedAt\)/);
  assert.match(nativeStats, /production1\.stationhead\.com/);
});

test('the statistics path has no credential replay or second HTTP client', () => {
  assert.doesNotMatch(nativeStats, /ICoreWebView2HttpRequestHeaders/);
  assert.doesNotMatch(nativeStats, /GetHeader\(/);
  assert.doesNotMatch(nativeStats, /Authorization/);
  assert.doesNotMatch(nativeStats, /RequestCredentials/);
  assert.doesNotMatch(nativeStats, /NativeStatsClient/);
  assert.doesNotMatch(nativeStats, /WinHttpDownload\(/);
  assert.doesNotMatch(nativeStats, /condition_variable|std::thread/);
});

test('JSON normalization and storage are implemented in C++', () => {
  assert.match(nativeStats, /JsonObject::Parse/);
  assert.match(nativeStats, /GetNamedArray\(L"chart_data"\)/);
  assert.match(nativeStats, /std::stable_sort/);
  assert.match(nativeStats, /normalized\.back\(\)\.value = point\.value/);
  assert.match(nativeStats, /normalized\.size\(\) > 45/);
  assert.match(nativeStats, /class NativeStatsStore/);
  assert.match(nativeStats, /history_\.push_back/);
  assert.match(nativeStats, /snapshot\.recentHour/);
});

test('the direct native path has no generated script or WebMessage protocol', () => {
  assert.doesNotMatch(nativeStats, /LR"JS|ExecuteScript|postMessage/);
  assert.doesNotMatch(nativeStats, /document_generation|auth_generation|request_id/);
  assert.doesNotMatch(nativeStats, /localStorage|sessionStorage/);
});

test('renderer directly consumes and observes the native store revision', () => {
  assert.match(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
  assert.match(panel, /SummarizeStationheadDailyPlays\(nativeStats\.daily, nowMs\)/);
  assert.match(renderer, /GlobalStationheadNativeStatsStore\(\)\.Revision\(\)/);
  assert.match(renderer, /nativeStatsChanged/);
  assert.match(renderer, /PanelSection::Music/);
});
