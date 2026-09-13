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
  'spotify_webview_foundation.inc',
  'spotify_host_lifecycle.inc',
  'spotify_controller_lifecycle.inc',
].map(name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8')).join('\n');
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('slow multi-window recovery is time based instead of retry-count based', () => {
  assert.match(phaseSync, /kSpotifyUnhealthyRenavigateMs = 30ULL \* 1000ULL/);
  assert.match(phaseSync, /kSpotifyRobustNavigateRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /kSpotifyRobustControllerRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /ShouldRenavigateUnhealthySlot/);
  assert.doesNotMatch(phaseSync, /kSpotifyRobustReloadThreshold|unhealthyChecks/);
  assert.doesNotMatch(header, /unhealthyChecks/);
});

test('healthy scheduler uses a five-minute ceiling and exact ten-second startup boundaries', () => {
  assert.match(phaseSync, /kSpotifyHealthyAuditMs = 5U \* 60U \* 1000U/);
  assert.match(header, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(
    phaseSync,
    /boundary =\s*scheduleStartTick_ \+[\s\S]*static_cast<ULONGLONG>\(i\) \* kSpotifyAccountStartOffsetMs/,
  );
  assert.match(phaseSync, /considerTick\(boundary\)/);
  assert.doesNotMatch(phaseSync, /kSpotifyAdaptiveSteadyStartMs|::SetTimer\(|KillTimer\(/);
});

test('usable Spotify controls are recovered through the dedicated trusted-input module', () => {
  assert.match(click, /ParseNormalizedPoint/);
  assert.match(click, /ClickSlotNormalizedPoint/);
  assert.match(click, /RefreshSpotifyHostLayout\(\)/);
  assert.doesNotMatch(phaseSync, /ParseNormalizedPoint|ClickSlotNormalizedPoint/);
});

test('ultra-light styling is fixed CSS without runtime source rewriting or MutationObserver churn', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript/);
  assert.match(scripts, /background-image: none !important/);
  assert.match(scripts, /img, picture, video, canvas/);
  assert.match(scripts, /display: none !important/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment|thread_local std::wstring/);
});

test('healthy slots are not continuously scanned by a second native watchdog', () => {
  assert.doesNotMatch(header, /playbackWatchdogIndex_|reconcileIndex_/);
  assert.doesNotMatch(spotify, /RunPlaybackWatchdog|kSpotifyPlaybackWatchdogTimer/);
});

test('healthy cursor changes do not relayout all playback hosts', () => {
  assert.match(
    layout,
    /const size_t recoveryIndex =[\s\S]*SlotStateNeedsRecovery\(slots_\[activeIndex\]\.state\)/,
  );
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(layout, /hostLayoutActiveSlot_ = recoveryIndex/);
  assert.match(
    layout,
    /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\)/,
  );
  assert.doesNotMatch(layout, /const bool active =/);
});

test('authentication recovery and healthy playback remain visible with compact healthy geometry', () => {
  assert.match(header, /unsigned hostLayoutMask_ = ~0u/);
  assert.match(header, /hostLayoutActiveSlot_ = kAccountCount/);
  assert.match(header, /hostLayoutAuthenticationSlot_ = kAccountCount/);
  assert.match(layout, /const size_t activeIndex = schedulerCursor_ % slots_\.size\(\)/);
  assert.match(layout, /foregroundAuthenticationIndex/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex/);
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 160/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 90/);
  assert.match(layout, /kSpotifyLowPowerPlaybackWidth = 96/);
  assert.match(layout, /kSpotifyLowPowerPlaybackHeight = 54/);
  assert.match(layout, /kSpotifyRecoveryInteractionWidth = 720/);
  assert.match(layout, /kSpotifyRecoveryInteractionHeight = 480/);
  assert.doesNotMatch(layout, /int width = 1;\s*int height = 1/);
  assert.match(
    layout,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/,
  );
  assert.match(layout, /const bool lowPowerPlayback =/);
  assert.match(layout, /put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(lowPowerPlayback \? FALSE : TRUE\)/);
  assert.match(layout, /x = client\.right \+ 32/);
  assert.match(layout, /insertAfter = HWND_TOP/);
});

test('cached authentication foreground avoids repeated WebView geometry notifications', () => {
  assert.match(layout, /maintainAuthenticationForeground\(false\)/);
  assert.match(layout, /SWP_NOMOVE \| SWP_NOSIZE/);
  assert.match(layout, /maintainAuthenticationForeground\(true\)/);
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
