import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const schedule = source('spotify_stagger_schedule.inc');
const lifecycle = source('spotify_host_lifecycle.inc');
const network = source('spotify_network_block.inc');
const radar = source('renderer_radar_ui.cpp');
const mediaBase = source('renderer_panels/media_section_base.inc');
const mediaWindow = source('renderer_panels/media_host_window.inc');
const phase = source('spotify_phase_sync.inc');

test('Spotify first WebView starts immediately when staged and later accounts stay serialized', () => {
  assert.match(schedule, /kSpotifyInitialStartDelayMs = 0/);
  assert.match(schedule, /scheduleStartTick_ = now \+ kSpotifyInitialStartDelayMs/);
  assert.match(schedule, /scheduleStartTick_ \+[\s\S]*kSpotifyAccountStartOffsetMs/);
  assert.match(schedule, /if \(now < scheduleStartTick_\) return/);
  assert.doesNotMatch(lifecycle + network, /CreateController\(slots_\[0\]\)/);
  assert.match(schedule, /BeginControllerCreate\(slot\)/);
  assert.equal((schedule.match(/BeginControllerCreate\(slot\)/g) || []).length, 1);
});

test('rain radar decoding yields CPU priority to playback work', () => {
  assert.match(
    radar,
    /radarComposeThread_ = std::thread\(\[this\] \{[\s\S]*SetThreadPriority\(GetCurrentThread\(\), THREAD_PRIORITY_BELOW_NORMAL\)/,
  );
  assert.match(radar, /ComposeRadarFrame\(\)/);
});

test('Spotify status repaint is event-driven instead of a periodic timer', () => {
  assert.doesNotMatch(mediaWindow, /kNativeSpotifyStatusInitialDelayMs|kNativeSpotifyStatusRefreshMs/);
  assert.doesNotMatch(mediaWindow, /kNativeSpotifyStatusTimer|SetTimer\(status/);
  assert.match(phase, /InvalidateSpotifyStatusForHost/);
  assert.match(phase, /InvalidateRect\(status, nullptr, FALSE\)/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogMs = 30U \* 1000U/);
});
