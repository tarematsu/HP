import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const nativeStatsUrl = new URL(
  '../../native/src/stationhead_native_stats.h', import.meta.url);
const nativePolicyUrl = new URL(
  '../../native/src/stationhead_native_stats_policy.h', import.meta.url);
const authPolicyUrl = new URL(
  '../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url);
const trackBoundaryUrl = new URL(
  '../../native/src/sh_track_boundary_script.h', import.meta.url);
const cmakeUrl = new URL('../../native/CMakeLists.txt', import.meta.url);
const rendererUrl = new URL(
  '../../native/src/renderer_panel_state.cpp', import.meta.url);
const panelUrl = new URL(
  '../../native/src/renderer_panels/media_section_v2.inc', import.meta.url);

const nativeStats = readFileSync(nativeStatsUrl, 'utf8');
const nativePolicy = readFileSync(nativePolicyUrl, 'utf8');
const authPolicy = readFileSync(authPolicyUrl, 'utf8');
const trackBoundary = readFileSync(trackBoundaryUrl, 'utf8');
const cmake = readFileSync(cmakeUrl, 'utf8');
const renderer = readFileSync(rendererUrl, 'utf8');
const panel = readFileSync(panelUrl, 'utf8');

const removedPolicies = [
  'sh_stats_session_policy_fix.h',
  'sh_stats_passive_response_policy_fix.h',
  'sh_stats_july26_baseline_policy_fix.h',
  'sh_stats_july23_baseline_policy_fix.h',
  'sh_stats_auth_fallback_policy_fix.h',
];

test('all generated play-count policy layers are removed', () => {
  for (const file of removedPolicies) {
    assert.equal(
      existsSync(new URL(`../../native/src/${file}`, import.meta.url)),
      false,
      `${file} must stay deleted`,
    );
  }
  assert.doesNotMatch(authPolicy, /sh_stats_/);
  assert.doesNotMatch(trackBoundary, /sh_stats_/);
});

test('the final compiled resource policy installs one native observer', () => {
  assert.match(
    cmake,
    /target_precompile_headers\(HomePanel PRIVATE\s+src\/stationhead_native_stats_policy\.h\)/,
  );
  assert.match(
    nativePolicy,
    /ApplyStationheadResourceBlockingWithNativeStats/,
  );
  assert.match(
    nativePolicy,
    /StationheadOwnsWorkerRequestFilters\(webview\)/,
  );
  assert.match(
    nativePolicy,
    /AttachStationheadNativeStatsObserver\(webview, config\.channelId\)/,
  );
});

test('WebView2 response capture is completely native and bounded', () => {
  assert.match(nativeStats, /ICoreWebView2_2/);
  assert.match(nativeStats, /add_WebResourceResponseReceived/);
  assert.match(nativeStats, /get_Request/);
  assert.match(nativeStats, /get_Response/);
  assert.match(nativeStats, /get_StatusCode/);
  assert.match(nativeStats, /GetContent/);
  assert.match(nativeStats, /kStationheadNativeStatsMaximumBodyBytes = 1024 \* 1024/);
  assert.match(nativeStats, /production1\.stationhead\.com/);
  assert.match(nativeStats, /L"\/me\/channel\/"/);
  assert.doesNotMatch(nativeStats, /LR"JS|ExecuteScript|postMessage/);
  assert.doesNotMatch(nativeStats, /document_generation|auth_generation|request_id/);
  assert.doesNotMatch(nativeStats, /authorization/i);
});

test('JSON normalization and storage are implemented in C++', () => {
  assert.match(nativeStats, /JsonObject::Parse/);
  assert.match(nativeStats, /GetNamedArray\(L"chart_data"\)/);
  assert.match(nativeStats, /std::stable_sort/);
  assert.match(nativeStats, /normalized\.back\(\)\.value = point\.value/);
  assert.match(nativeStats, /normalized\.size\(\) > 45/);
  assert.match(nativeStats, /class StationheadNativeStatsStore/);
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
