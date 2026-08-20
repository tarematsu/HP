import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nativeStatsHeader = readFileSync(
  new URL('../../native/src/stationhead_native_stats.h', import.meta.url), 'utf8');
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url), 'utf8');
const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');
const messagePolicy = readFileSync(
  new URL('../../native/src/sh_stats_webview_message_policy_fix.h', import.meta.url), 'utf8');
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url), 'utf8');
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const renderer = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url), 'utf8');
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url), 'utf8');

test('July 19 stats policy is the final Stationhead acquisition layer', () => {
  assert.match(composition, /#include "sh_july19_stats_policy_fix\.h"/);
  assert.match(
    july19Policy,
    /#define ApplyStationheadResourceBlocking ApplyStationheadJuly19ResourcePolicy/,
  );
  assert.match(
    july19Policy,
    /#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript/,
  );
  assert.match(
    july19Policy,
    /#define StationheadApiPlayStatsScript StationheadJuly19ApiPlayStatsScript/,
  );
  assert.match(
    july19Policy,
    /kStationheadJuly19StatsIntervalMs = 5 \* 60'000/,
  );
});

test('July 19 document-start capture observes page fetch and XHR Authorization', () => {
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /const NativeXhr = window\.XMLHttpRequest/);
  assert.match(july19Policy, /NativeXhr\.prototype\.open = function/);
  assert.match(july19Policy, /NativeXhr\.prototype\.setRequestHeader = function/);
  assert.match(july19Policy, /NativeXhr\.prototype\.send = function/);
  assert.match(july19Policy, /getHeader\('authorization'\)/);
  assert.match(july19Policy, /'sth-device-uid'/);
  assert.match(july19Policy, /'app-platform'/);
  assert.match(july19Policy, /'app-version'/);
  assert.match(july19Policy, /stationhead-auth-ready/);
  assert.doesNotMatch(july19Policy, /auth_generation|document_generation|request_id/);
});

test('Primary performs the July 19 authenticated streakStats request every five minutes', () => {
  assert.match(playerSource, /!IsSecondary\(\)[\s\S]*PollDailyPlayStats\(nowMs\)/);
  assert.match(playerSource, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
  assert.match(july19Policy, /production1\.stationhead\.com\/me\/channel\//);
  assert.match(july19Policy, /\/streakStats/);
  assert.match(july19Policy, /credentials: 'include'/);
  assert.match(july19Policy, /cache: 'no-store'/);
  assert.match(july19Policy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(july19Policy, /stationhead-play-stats/);
  assert.doesNotMatch(july19Policy, /StationheadPlayStatsSuccessAt|10 \* 60 \* 1000/);
});

test('no native HTTP or response observer owns play-count acquisition', () => {
  assert.match(nativeStatsHeader, /PublishStationheadNativeStatsMessage/);
  assert.doesNotMatch(nativeStatsHeader, /AttachStationheadNativeStats/);
  assert.match(nativeStats, /class NativeStatsStore/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
  assert.doesNotMatch(
    nativeStats,
    /WinHttpDownload|std::thread|condition_variable|WebResourceResponseReceived|WebResourceRequested|GetDevToolsProtocolEventReceiver/,
  );
  assert.doesNotMatch(
    july19Policy,
    /AttachStationheadNativeStats|add_WebResourceResponseReceived|WinHttpDownload/,
  );
});

test('generationless July 19 stats messages feed the native store before later handlers', () => {
  assert.match(messagePolicy, /PublishStationheadNativeStatsMessage/);
  assert.match(messagePolicy, /if \(consumed\) return S_OK/);
  assert.doesNotMatch(messagePolicy, /auth_generation|document_generation|request_id/);
  assert.match(nativeStats, /stationhead-play-stats/);
  assert.match(nativeStats, /GetNamedArray\(L"chart_data"\)/);
});

test('renderer still consumes and observes the native store revision', () => {
  assert.match(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
  assert.match(panel, /SummarizeStationheadDailyPlays\(nativeStats\.daily, nowMs\)/);
  assert.match(renderer, /GlobalStationheadNativeStatsStore\(\)\.Revision\(\)/);
  assert.match(renderer, /nativeStatsChanged/);
});
