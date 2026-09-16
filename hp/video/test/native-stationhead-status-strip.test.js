import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const bridge = source('stationhead_status_strip_bridge.h');
const startupReset = source('webview_startup_cache_reset.h');
const mediaBase = source('renderer_panels/media_section_base.inc');
const statusStrip = source('renderer_panels/media_host_window.inc');

test('Stationhead play-count polling is retired from the active player path', () => {
  assert.match(
    startupReset,
    /#define kStationheadDailyPlayStatsIntervalMs 4'000'000'000'000'000'000LL/,
  );
  assert.match(
    startupReset,
    /#define StationheadApiPlayStatsScript\(channelId\) std::wstring\(L"void 0;"\)/,
  );
  assert.doesNotMatch(statusStrip, /StationheadStatusStripTodayPlayCount|再生数/);
});

test('Stationhead card renders only the cached projected current track title', () => {
  assert.match(mediaBase, /stationhead_status_strip_bridge\.h/);
  assert.match(bridge, /native-playback-a\.json/);
  assert.match(bridge, /GetNamedBoolean\(L"playing", false\)/);
  assert.match(bridge, /GetNamedBoolean\(L"stale", false\)/);
  assert.match(bridge, /currentIndex/);
  assert.match(bridge, /queueEndAt/);
  assert.match(bridge, /kTrackTransitionHoldMs = 500/);
  assert.match(bridge, /PollStationheadStatusStripCurrentTrackTitle/);
  assert.match(bridge, /stationheadStatusStripTrackTitle = std::move\(next\)/);
  assert.match(statusStrip, /const size_t cellCount = statuses\.size\(\) \+ 1/);
  assert.match(statusStrip, /StationheadStatusStripCurrentTrackTitle\(\)/);
  assert.doesNotMatch(
    statusStrip,
    /StationheadStatusStripCurrentTrackTitle\(gNativeMediaDataDir, UnixMillis\(\)\)/,
  );
  assert.match(statusStrip, /L"Stationhead"/);
  assert.match(statusStrip, /stationheadTrack\.empty\(\) \? L"--" : stationheadTrack/);
});

test('Stationhead status polling is one minute and staggered between Spotify phases', () => {
  assert.match(statusStrip, /kNativeSpotifyStatusPollMs = 60U \* 1000U/);
  assert.match(statusStrip, /kNativeStationheadStatusPollTimer = 0x5351/);
  assert.match(statusStrip, /kNativeStationheadStatusPollMs = 60U \* 1000U/);
  assert.match(
    statusStrip,
    /kNativeStationheadStatusInitialPhaseMs = 7U \* 1000U \+ 500U/,
  );
  assert.match(
    statusStrip,
    /PollStationheadStatusStripCurrentTrackTitle\([\s\S]*gNativeMediaDataDir, UnixMillis\(\)\)/,
  );
  assert.match(
    statusStrip,
    /SetTimer\(status, kNativeStationheadStatusPollTimer,[\s\S]*kNativeStationheadStatusInitialPhaseMs/,
  );
  assert.match(
    statusStrip,
    /SetTimer\(hwnd, kNativeStationheadStatusPollTimer,[\s\S]*kNativeStationheadStatusPollMs/,
  );
  assert.match(statusStrip, /KillTimer\(hwnd, kNativeStationheadStatusPollTimer\)/);
});

test('Stationhead status title adds no network request loop', () => {
  assert.doesNotMatch(bridge, /fetch\(|ExecuteScript|WinHttp|SetTimer|setInterval/);
});
