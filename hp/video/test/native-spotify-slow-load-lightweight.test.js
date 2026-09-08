import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const spotify = [
  'spotify_webviews.cpp',
  'spotify_webviews_core_part1.inc',
  'spotify_webviews_core_part2.inc',
  'spotify_webviews_core_part3.inc',
  'spotify_webviews_core_part4.inc',
].map(name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8')).join('\n');
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('slow six-window recovery is time based instead of retry-count based', () => {
  assert.match(phaseSync, /kSpotifyUnhealthyRenavigateMs = 60ULL \* 1000ULL/);
  assert.match(phaseSync, /kSpotifyRobustNavigateRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /kSpotifyRobustControllerRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /ShouldRenavigateUnhealthySlot/);
  assert.doesNotMatch(phaseSync, /kSpotifyRobustReloadThreshold|unhealthyChecks/);
  assert.doesNotMatch(header, /unhealthyChecks/);
});

test('usable Spotify controls are recovered through normalized trusted points', () => {
  assert.match(phaseSync, /ParseNormalizedPoint/);
  assert.match(phaseSync, /ClickSlotNormalizedPoint/);
  assert.match(phaseSync, /RefreshSpotifyHostLayout\(\)/);
});

test('ultra-light styling is fixed CSS without runtime source rewriting or MutationObserver churn', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript/);
  assert.match(scripts, /background-image: none !important/);
  assert.match(scripts, /img, picture, video, canvas/);
  assert.match(scripts, /display: none !important/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment|thread_local std::wstring/);
});

test('healthy slots are not continuously scanned by a second watchdog', () => {
  assert.doesNotMatch(header, /playbackWatchdogIndex_|reconcileIndex_/);
  assert.doesNotMatch(spotify, /RunPlaybackWatchdog|kSpotifyPlaybackWatchdogTimer/);
  assert.doesNotMatch(scripts, /setInterval\(/);
});

test('only authentication is visible while all playback hosts retain stable offscreen viewports', () => {
  assert.match(header, /unsigned hostLayoutMask_ = ~0u/);
  assert.match(header, /hostLayoutActiveSlot_ = kAccountCount/);
  assert.match(header, /hostLayoutAuthenticationSlot_ = kAccountCount/);
  assert.match(layout, /const size_t activeIndex = staggerSlotIndex_ % slots_\.size\(\)/);
  assert.match(layout, /foregroundAuthenticationIndex/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex/);
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(spotify, /kSpotifyParkedPlaybackWidth = 320/);
  assert.match(spotify, /kSpotifyParkedPlaybackHeight = 180/);
  assert.doesNotMatch(spotify, /int width = 1;\s*int height = 1/);
  assert.match(
    spotify,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/,
  );
  assert.match(spotify, /SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(spotify, /x = client\.right \+ 32/);
  assert.match(spotify, /insertAfter = HWND_TOP/);
});

test('login checks use cached navigation state instead of repeated COM source reads', () => {
  assert.match(header, /bool loginPage = false/);
  assert.match(
    phaseSync,
    /SlotIsLoginPage\(const Slot& slot\)[\s\S]*return slot\.webview && slot\.loginPage;/,
  );
  const loginCheck = phaseSync.slice(
    phaseSync.indexOf('bool SpotifyWebViews::SlotIsLoginPage'),
    phaseSync.indexOf('void SpotifyWebViews::BeginControllerCreate'),
  );
  assert.doesNotMatch(loginCheck, /get_Source|CoTaskMemFree/);
});
