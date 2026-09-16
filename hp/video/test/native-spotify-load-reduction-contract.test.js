import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourcePart = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const spotify = [
  'spotify_webviews.cpp',
  'spotify_webview_foundation.inc',
  'spotify_host_lifecycle.inc',
  'spotify_controller_lifecycle.inc',
].map(sourcePart).join('\n');
const spotifyHeader = sourcePart('spotify_webviews.h');
const webviewPolicy = sourcePart('webview_feature_policy.h');
const phase = sourcePart('spotify_phase_sync.inc');
const schedule = sourcePart('spotify_stagger_schedule.inc');
const scripts = sourcePart('spotify_static_scripts.inc');
const layout = sourcePart('spotify_host_layout.inc');
const music = sourcePart('spotify_music_target.inc');

test('Spotify WebViews serialize startup without UI-thread blocking or polling timers', () => {
  assert.doesNotMatch(spotify, /CreateController\(slots_\[0\]\)/);
  assert.match(spotifyHeader, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(spotifyHeader, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(schedule, /kSpotifyInitialStartDelayMs = 0/);
  assert.match(schedule, /scheduleStartTick_ = now \+ kSpotifyInitialStartDelayMs/);
  assert.match(schedule, /startupReady/);
  assert.match(schedule, /if \(!slot\.webview\)[\s\S]*BeginControllerCreate\(slot\)/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phase, /slot\.nextRecoveryTick/);
  assert.doesNotMatch(schedule, /SimpleSpotifyScheduledIndex|kSpotifySimpleSteadyTurnMs/);
  assert.doesNotMatch(spotify, /kSpotifyStartupTimer|kSpotifyStartupStaggerMs|Sleep\(/);
  assert.doesNotMatch(phase + schedule + spotify, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
});

test('Spotify layout keeps a full-client internal surface and exposes the selected Monitor C/D slot', () => {
  assert.match(layout, /const int hostX = client\.left;/);
  assert.match(layout, /const int hostY = client\.top;/);
  assert.match(layout, /const int width = std::max\(1L, client\.right - client\.left\);/);
  assert.match(layout, /const int height = std::max\(1L, client\.bottom - client\.top\);/);
  assert.match(layout, /const bool monitorForeground =\s*static_cast<int>\(i\) == monitorForegroundSlot_/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /authentication \|\| monitorForeground/);
  assert.match(layout, /const bool positionChanged =/);
  assert.match(layout, /const bool sizeChanged =/);
  assert.match(layout, /const bool zOrderChanged =/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.match(layout, /SWP_SHOWWINDOW/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /ShowWindow\(slot\.hostWindow/);
});

test('Spotify recovery keeps the same full-client viewport used during steady playback', () => {
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.doesNotMatch(layout, /else if \(recovery\)/);
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);
  assert.doesNotMatch(layout, /playbackConfirmed[\s\S]*\? 1/);
});

test('Spotify does not override WebView2 memory target and controller visibility stays true', () => {
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(spotify, /ApplySpotifyPermanentLowMemoryMode|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(spotify, /slot\.controller->put_IsVisible\(FALSE\)/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
});

test('Spotify layout avoids redundant controller geometry COM calls', () => {
  assert.match(spotifyHeader, /ICoreWebView2Controller\* hostLayoutController = nullptr/);
  assert.doesNotMatch(spotifyHeader, /hostLayoutReducedZoomApplied/);
  assert.match(layout, /const bool controllerChanged =/);
  assert.match(layout, /if \(controllerChanged\)[\s\S]*put_ZoomFactor\(kSpotifySurfaceZoom\)/);
  assert.doesNotMatch(layout, /get_ZoomFactor\(/);
});

test('authentication keeps foreground repair without account badge work', () => {
  assert.doesNotMatch(spotifyHeader, /authenticationBadgeTick/);
  assert.doesNotMatch(layout, /kSpotifyAuthenticationBadgeBootstrapScript|ExecuteScript/);
  assert.match(layout, /maintainAuthenticationForeground/);
  assert.doesNotMatch(scripts, /spotify:account|__homePanelSpotifyAccount|mountBadge/);
});

test('each Spotify scheduler pass performs one round-robin scan and at most one layout refresh', () => {
  assert.equal((schedule.match(/RefreshSpotifyHostLayout\(\);/g) || []).length, 1);
  assert.equal((schedule.match(/for \(size_t step = 0; step < count; \+\+step\)/g) || []).length, 1);
  assert.match(schedule, /schedulerCursor_ = selected/);
  assert.match(schedule, /candidate\.asyncWork != AsyncWork::None/);
});

test('scheduler state does not duplicate slot recovery or async state', () => {
  assert.match(spotifyHeader, /size_t schedulerCursor_ = 0/);
  assert.match(spotifyHeader, /enum class AsyncWork/);
  assert.match(spotifyHeader, /ULONGLONG nextRecoveryTick = 0/);
  assert.match(spotifyHeader, /ULONGLONG asyncEpoch = 0/);
  assert.doesNotMatch(spotifyHeader, /lastTimedReconcileTick|lastModeNavigateTick|unhealthySinceTick|reconcileRequestGeneration|timedObserverInstallGeneration/);
});

test('Spotify page bootstrap performs no CSS or DOM styling reduction', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /window\.chrome\.webview\.addEventListener\('message'/);
  assert.doesNotMatch(scripts, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(scripts, /__homePanelSpotifyStaticLightweight/);
  assert.doesNotMatch(scripts, /!important/);
  assert.doesNotMatch(scripts, /animation\s*:|transition\s*:|background-image\s*:/);
  assert.doesNotMatch(scripts, /display\s*:|visibility\s*:|pointer-events\s*:|content-visibility\s*:/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment|thread_local std::wstring/);
});

test('Spotify resource blocking is completely disabled', () => {
  assert.doesNotMatch(spotify, /Network\.setBlockedURLs/);
  assert.doesNotMatch(spotify, /kSpotifyBlockedDecorativeUrls|kSpotifyUnblockedDecorativeUrls/);
  assert.doesNotMatch(spotify, /SetSpotifyDecorativeResourceBlocking/);
  assert.doesNotMatch(spotify, /AddWebResourceRequestedFilter/);
  assert.doesNotMatch(spotify, /CreateWebResourceResponse/);
  assert.doesNotMatch(spotifyHeader, /webResourceRequestedToken/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_/);
});

test('Spotify trims browser UI services without disabling script or web messages', () => {
  assert.match(spotify, /slot\.controller\.Get\(\), slot\.webview\.Get\(\), true/);
  assert.match(webviewPolicy, /put_AreDefaultScriptDialogsEnabled\(FALSE\)/);
  assert.match(webviewPolicy, /put_IsPasswordAutosaveEnabled\(TRUE\)/);
  assert.match(webviewPolicy, /put_IsGeneralAutofillEnabled\(TRUE\)/);
  assert.match(webviewPolicy, /put_IsPinchZoomEnabled\(FALSE\)/);
  assert.match(webviewPolicy, /put_IsSwipeNavigationEnabled\(FALSE\)/);
  assert.match(webviewPolicy, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(webviewPolicy, /put_IsWebMessageEnabled\(webMessagesEnabled \? TRUE : FALSE\)/);
});

test('track changes prefer Spotify SPA links and retain full navigation as fallback', () => {
  assert.match(scripts, /kSpotifySpaRouteScript/);
  assert.match(scripts, /document\.querySelectorAll\('a\[href\*="\/track\/"\]'\)/);
  assert.match(scripts, /link\.click\(\)/);
  assert.match(music, /ExecuteScript\(\s*kSpotifySpaRouteScript/);
  assert.match(music, /requestedView->Navigate\(currentTrack->url\.c_str\(\)\)/);
});
