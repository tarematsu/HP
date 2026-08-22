import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');
const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url), 'utf8');
const messagePolicy = readFileSync(
  new URL('../../native/src/sh_stats_webview_message_policy_fix.h', import.meta.url), 'utf8');
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url), 'utf8');
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url), 'utf8');

test('July 19 auth capture remains in the Stationhead composition', () => {
  assert.match(composition, /#include "sh_july19_stats_policy_fix\.h"/);
  assert.match(
    july19Policy,
    /#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript/,
  );
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /const NativeXhr = window\.XMLHttpRequest/);
  assert.match(july19Policy, /getHeader\('authorization'\)/);
});

test('Primary owns the PR48 authenticated streakStats request', () => {
  assert.match(playerSource, /!IsSecondary\(\)[\s\S]*PollDailyPlayStats\(nowMs\)/);
  assert.match(playerSource, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
  assert.match(activePolicy, /production1\.stationhead\.com\/me\/channel\//);
  assert.match(activePolicy, /\/streakStats/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /error: 'no-auth-header'/);
  assert.match(activePolicy, /10 \* 60 \* 1000/);
  assert.match(activePolicy, /response\.status === 401 \|\| response\.status === 403/);
});

test('successful stats are no longer consumed into the later native store', () => {
  assert.doesNotMatch(messagePolicy, /PublishStationheadNativeStatsMessage/);
  assert.doesNotMatch(messagePolicy, /if \(consumed\) return S_OK/);
  assert.match(webview, /type == L"stationhead-play-stats"/);
  assert.match(webview, /status_\.dailyPlayCounts = std::move\(normalized\)/);
  assert.match(webview, /status_\.dailyPlayStatsUpdatedAt = receivedAt/);
});

test('Music panel reads StationheadStatus and App history', () => {
  assert.match(panel, /nativeStationhead_\.dailyPlayCounts/);
  assert.match(panel, /nativeStationhead_\.dailyPlayStatsUpdatedAt/);
  assert.match(panel, /nativeStationheadPlayHistory_/);
  assert.match(
    panel,
    /SummarizeStationheadDailyPlays\(nativeStationhead_\.dailyPlayCounts, nowMs\)/,
  );
  assert.doesNotMatch(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
});
