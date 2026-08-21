import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shared = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url), 'utf8');
const policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url), 'utf8');
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');
const history = readFileSync(
  new URL('../../native/src/app_stationhead_history.cpp', import.meta.url), 'utf8');
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('final acquisition selection returns to the pre-368 page-owned path', () => {
  assert.match(composition, /#include "sh_july19_stats_policy_fix\.h"/);
  assert.match(policy, /StationheadPre368AuthAndLoginSettlementScript/);
  assert.match(policy, /StationheadPre368ApiPlayStatsScript/);
  assert.match(
    policy,
    /#define StationheadAuthCaptureScript StationheadPre368AuthAndLoginSettlementScript/,
  );
  assert.match(
    policy,
    /#define StationheadApiPlayStatsScript StationheadPre368ApiPlayStatsScript/,
  );
  assert.doesNotMatch(policy, /sh_stats_webview_message_policy_fix|stationhead_native_stats/);
});

test('original pre-368 capture still owns Authorization observation', () => {
  assert.match(shared, /window\.fetch = function\(input, init\)/);
  assert.match(shared, /NativeXhr\.prototype\.send = function/);
  assert.match(shared, /window\.__homepanelStationheadAuthHeaders = next/);
  assert.match(shared, /homepanel-stationhead-auth-ready/);
});

test('Primary uses the stable streakStats cadence and request shape', () => {
  assert.match(playerSource, /!IsSecondary\(\)[\s\S]*PollDailyPlayStats\(nowMs\)/);
  assert.match(playerSource, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
  assert.match(policy, /production1\.stationhead\.com\/me\/channel\//);
  assert.match(policy, /\/streakStats/);
  assert.match(policy, /credentials: 'include'/);
  assert.match(policy, /10 \* 60 \* 1000/);
});

test('successful stats flow through StationheadStatus and App history', () => {
  const statsAt = webview.indexOf('if (type == L"stationhead-play-stats") {');
  assert.ok(statsAt >= 0);
  const handler = webview.slice(statsAt, statsAt + 9000);
  assert.match(handler, /status_\.dailyPlayCounts = std::move\(normalized\)/);
  assert.match(handler, /status_\.dailyPlayStatsUpdatedAt = receivedAt/);
  assert.match(handler, /PostChange\(\)/);
  assert.match(history, /status\.dailyPlayCounts/);
  assert.match(history, /nativeStationheadPlayHistory_/);
});

test('Music panel consumes the same StationheadStatus and history path', () => {
  assert.match(panel, /nativeStationhead_\.dailyPlayCounts/);
  assert.match(panel, /nativeStationhead_\.dailyPlayStatsUpdatedAt/);
  assert.match(panel, /RecentStationheadPlayIncrease\(nativeStationheadPlayHistory_\)/);
  assert.doesNotMatch(panel, /GlobalStationheadNativeStatsStore/);
});
