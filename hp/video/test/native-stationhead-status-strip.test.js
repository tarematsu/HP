import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const statsPolicy = source('sh_july19_stats_policy_fix.h');
const player = source('sh.cpp');
const bridge = source('stationhead_status_strip_bridge.h');
const handles = source('app_stationhead_handles.cpp');
const mediaBase = source('renderer_panels/media_section_base.inc');
const statusStrip = source('renderer_panels/media_host_window.inc');

test('Stationhead authenticated daily play count acquisition remains active', () => {
  assert.match(statsPolicy, /production1\.stationhead\.com\/me\/channel\//);
  assert.match(statsPolicy, /\/streakStats/);
  assert.match(statsPolicy, /type: 'stationhead-play-stats'/);
  assert.match(statsPolicy, /kStationheadJuly19StatsIntervalMs = 5 \* 60'000/);
  assert.match(player, /PollDailyPlayStats\(int64_t nowMs\)/);
  assert.match(player, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
});

test('Stationhead today count is reused by the existing native status strip', () => {
  assert.match(bridge, /SummarizeStationheadDailyPlays\(status\.dailyPlayCounts, nowMs\)/);
  assert.match(bridge, /stationheadStatusStripTodayPlayCount/);
  assert.match(handles, /PublishStationheadStatusStripPlayCount\(status, UnixMillis\(\)\)/);
  assert.match(mediaBase, /stationhead_status_strip_bridge\.h/);

  assert.match(statusStrip, /const size_t cellCount = statuses\.size\(\) \+ 1/);
  assert.match(statusStrip, /StationheadStatusStripTodayPlayCount\(\)/);
  assert.match(statusStrip, /L"Stationhead"/);
  assert.match(statusStrip, /L"再生数 " \+ std::to_wstring\(stationheadPlayCount\)/);
  assert.match(statusStrip, /L"再生数 --"/);
  assert.match(statusStrip, /InvalidateRect\(hwnd, nullptr, FALSE\)/);
});

test('Stationhead status strip does not add a new request loop', () => {
  assert.doesNotMatch(bridge, /fetch\(|ExecuteScript|SetTimer|setInterval/);
  assert.doesNotMatch(handles, /streakStats|fetch\(/);
  assert.match(statusStrip, /kNativeSpotifyStatusPollMs = 60U \* 1000U/);
});
