import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const nativeStatsHeader = readFileSync(
  new URL('../../native/src/stationhead_native_stats.h', import.meta.url), 'utf8');
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url), 'utf8');
const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url), 'utf8');
const messagePolicy = readFileSync(
  new URL('../../native/src/sh_stats_webview_message_policy_fix.h', import.meta.url), 'utf8');
const trackBoundary = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url), 'utf8');
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const renderer = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url), 'utf8');
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url), 'utf8');

const removedPolicies = [
  'sh_stats_session_policy_fix.h',
  'sh_stats_passive_response_policy_fix.h',
  'sh_stats_july26_baseline_policy_fix.h',
  'sh_stats_july23_baseline_policy_fix.h',
  'sh_stats_auth_fallback_policy_fix.h',
  'stationhead_native_stats_policy.h',
];

test('old stacked stats policies remain removed', () => {
  for (const file of removedPolicies) {
    assert.equal(
      existsSync(new URL(`../../native/src/${file}`, import.meta.url)),
      false,
      `${file} must stay deleted`,
    );
  }
  assert.doesNotMatch(cmake, /stationhead_native_stats_policy/);
});

test('native stats is a parser and store, not a network client', () => {
  assert.match(cmake, /src\/stationhead_native_stats\.cpp/);
  assert.match(nativeStatsHeader, /PublishStationheadNativeStatsMessage/);
  assert.match(nativeStats, /class NativeStatsStore/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
  assert.match(nativeStats, /GetNamedArray\(L"chart_data"\)/);
  assert.doesNotMatch(
    nativeStats,
    /WinHttpDownload|std::thread|condition_variable|GetDevToolsProtocolEventReceiver|Network\.|WebResourceRequested|WebResourceResponseReceived/,
  );
});

test('Primary owns one five-minute in-WebView streakStats request', () => {
  assert.match(
    playerSource,
    /!IsSecondary\(\)[\s\S]*PollDailyPlayStats\(nowMs\)/,
  );
  assert.match(
    playerSource,
    /StationheadApiPlayStatsScript\(config_\.channelId\)/,
  );
  assert.match(
    playbackPolicy,
    /#define StationheadApiPlayStatsScript StationheadPrimaryWebViewStatsScript/,
  );
  assert.match(playbackPolicy, /production1\.stationhead\.com\/me\/channel\//);
  assert.match(playbackPolicy, /\/streakStats/);
  assert.match(playbackPolicy, /credentials: 'include'/);
  assert.match(playbackPolicy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(playbackPolicy, /stationhead-play-stats/);
  assert.doesNotMatch(playbackPolicy, /kStationheadLegacyStatsPollDisabledIntervalMs/);
  assert.doesNotMatch(playbackPolicy, /StationheadPlayStatsSuccessAt|10 \* 60 \* 1000/);
});

test('document-start keeps hardened auth capture and current login settlement together', () => {
  assert.match(trackBoundary, /StationheadAuthAndLoginSettlementScript/);
  assert.match(
    trackBoundary,
    /std::wstring script = StationheadAuthCaptureScript\(\)/,
  );
  assert.match(trackBoundary, /script\.append\(StationheadLoginSettlementScript\(\)\)/);
  assert.match(
    trackBoundary,
    /#define StationheadAuthCaptureScript StationheadAuthAndLoginSettlementScript/,
  );
});

test('trusted WebView stats messages feed the native store directly', () => {
  assert.match(messagePolicy, /PublishStationheadNativeStatsMessage/);
  assert.match(messagePolicy, /WrapStationheadWebMessageHandler/);
  assert.match(messagePolicy, /WrapStationheadAuthCompletionMessageHandler/);
  assert.match(messagePolicy, /if \(consumed\) return S_OK/);
  assert.match(nativeStats, /type.*stationhead-play-stats/s);
  assert.doesNotMatch(messagePolicy, /request_id|document_generation|auth_generation/);
});

test('JSON validation and recent-hour storage remain native', () => {
  assert.match(nativeStats, /JsonObject::Parse/);
  assert.match(nativeStats, /std::stable_sort/);
  assert.match(nativeStats, /normalized\.back\(\)\.value = point\.value/);
  assert.match(nativeStats, /normalized\.size\(\) > 45/);
  assert.match(nativeStats, /history_\.push_back/);
  assert.match(nativeStats, /snapshot\.recentHour/);
});

test('renderer still redraws from the native store revision', () => {
  assert.match(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
  assert.match(panel, /SummarizeStationheadDailyPlays\(nativeStats\.daily, nowMs\)/);
  assert.match(renderer, /GlobalStationheadNativeStatsStore\(\)\.Revision\(\)/);
  assert.match(renderer, /nativeStatsChanged/);
  assert.match(renderer, /PanelSection::Music/);
});
