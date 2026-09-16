import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const phaseSync = source('spotify_phase_sync.inc');
const scripts = source('spotify_static_scripts.inc');
const spotify = [
  'spotify_webviews.cpp',
  'spotify_webview_foundation.inc',
  'spotify_host_lifecycle.inc',
  'spotify_controller_lifecycle.inc',
].map(source).join('\n');
const layout = source('spotify_host_layout.inc');
const click = source('spotify_background_click.inc');
const header = source('spotify_webviews.h');

test('slow multi-window recovery uses one time-based retry instead of layered watchdogs', () => {
  assert.match(phaseSync, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phaseSync, /kSpotifyControllerRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /slot\.nextRecoveryTick = now \+ kSpotifyRecoveryRetryMs/);
  assert.doesNotMatch(phaseSync, /kSpotifyUnhealthyRenavigateMs|kSpotifyRobustNavigateRetryMs|ShouldRenavigateUnhealthySlot|unhealthyChecks/);
  assert.doesNotMatch(header, /lastModeNavigateTick|unhealthySinceTick|unhealthyChecks/);
});

test('healthy scheduler uses an hourly safety ceiling and exact ten-second startup boundaries', () => {
  assert.match(phaseSync, /kSpotifyHealthyAuditMs = 60U \* 60U \* 1000U/);
  assert.match(header, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(phaseSync, /static_cast<ULONGLONG>\(i\) \* kSpotifyAccountStartOffsetMs/);
  assert.match(phaseSync, /considerTick\(boundary\)/);
  assert.doesNotMatch(phaseSync, /::SetTimer\(|KillTimer\(/);
});

test('usable Spotify controls are recovered through the dedicated trusted-input module', () => {
  assert.match(click, /ParseCssPoint/);
  assert.match(click, /ClickSlotCssPoint/);
  assert.match(click, /RefreshSpotifyHostLayout\(\)/);
  assert.doesNotMatch(phaseSync, /ParseCssPoint|ClickSlotCssPoint/);
});

test('Spotify bootstrap keeps only the native bridge and injects no styling', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript/);
  assert.match(scripts, /window\.chrome\.webview\.addEventListener\('message'/);
  assert.doesNotMatch(scripts, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(scripts, /__homePanelSpotifyStaticLightweight/);
  assert.doesNotMatch(scripts, /!important|content-visibility|pointer-events/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment|thread_local std::wstring/);
});

test('healthy slots are not continuously scanned by a second native watchdog', () => {
  assert.doesNotMatch(header, /playbackWatchdogIndex_|reconcileIndex_/);
  assert.doesNotMatch(spotify, /RunPlaybackWatchdog|kSpotifyPlaybackWatchdogTimer/);
});

test('healthy cursor changes do not relayout all playback hosts', () => {
  assert.match(layout, /const size_t recoveryIndex =/);
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(layout, /hostLayoutActiveSlot_ = recoveryIndex/);
  assert.match(layout, /SlotStateNeedsRecovery\(slots_\[activeIndex\]\.state\)/);
  assert.doesNotMatch(layout, /const bool active =/);
});

test('pre-playback recovery and confirmed playback share the same full-client viewport', () => {
  assert.match(layout, /const int hostX = client\.left/);
  assert.match(layout, /const int hostY = client\.top/);
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);
  assert.match(layout, /const bool monitorForeground =\s*SpotifyRuntimeLaneForAccount\(i\) == monitorForegroundSlot_/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(spotify, /ApplySpotifyPermanentLowMemoryMode|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(spotify, /slot\.controller->put_IsVisible\(FALSE\)/);
});

test('cached authentication foreground avoids repeated WebView geometry notifications', () => {
  assert.match(layout, /maintainAuthenticationForeground\(false\)/);
  assert.match(layout, /SWP_NOMOVE \| SWP_NOSIZE/);
  assert.match(layout, /maintainAuthenticationForeground\(true\)/);
});

test('login checks use cached navigation state instead of repeated COM source reads', () => {
  assert.match(header, /bool loginPage = false/);
  assert.match(phaseSync, /return slot\.webview && slot\.loginPage/);
  const loginCheck = phaseSync.slice(
    phaseSync.indexOf('bool SpotifyWebViews::SlotIsLoginPage'),
    phaseSync.indexOf('void SpotifyWebViews::BeginControllerCreate'),
  );
  assert.doesNotMatch(loginCheck, /get_Source|CoTaskMemFree/);
});
