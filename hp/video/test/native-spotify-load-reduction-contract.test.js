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
const phase = sourcePart('spotify_phase_sync.inc');
const schedule = sourcePart('spotify_stagger_schedule.inc');
const scripts = sourcePart('spotify_static_scripts.inc');
const layout = sourcePart('spotify_host_layout.inc');
const music = sourcePart('spotify_music_target.inc');

test('Spotify WebViews serialize startup without UI-thread blocking or polling timers', () => {
  assert.doesNotMatch(spotify, /CreateController\(slots_\[0\]\)/);
  assert.match(spotifyHeader, /kSpotifyAccountStartOffsetMs = 60ULL \* 1000ULL/);
  assert.match(spotifyHeader, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(schedule, /kSpotifyInitialStartDelayMs = 4ULL \* 1000ULL/);
  assert.match(schedule, /scheduleStartTick_ = now \+ kSpotifyInitialStartDelayMs/);
  assert.match(schedule, /startupReady/);
  assert.match(schedule, /if \(!slot\.webview\)[\s\S]*BeginControllerCreate\(slot\)/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phase, /slot\.nextRecoveryTick/);
  assert.doesNotMatch(schedule, /SimpleSpotifyScheduledIndex|kSpotifySimpleSteadyTurnMs/);
  assert.doesNotMatch(spotify, /kSpotifyStartupTimer|kSpotifyStartupStaggerMs|Sleep\(/);
  assert.doesNotMatch(phase + schedule + spotify, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
});

test('Spotify layout keeps pre-playback full-size behind native UI and confirmed playback at 1x1', () => {
  assert.match(layout, /const bool compactPlayback =\s*slot\.playbackConfirmed && CurrentMusicTrack\(slot\) != nullptr/);
  assert.match(layout, /int width = compactPlayback \? 1 : clientWidth;/);
  assert.match(layout, /int height = compactPlayback \? 1 : clientHeight;/);
  assert.match(layout, /HWND insertAfter = HWND_BOTTOM;/);
  assert.match(layout, /const bool positionChanged =/);
  assert.match(layout, /const bool sizeChanged =/);
  assert.match(layout, /const bool zOrderChanged =/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.match(layout, /SWP_SHOWWINDOW/);
  assert.doesNotMatch(layout, /ShowWindow\(slot\.hostWindow/);
});

test('Spotify recovery uses the full dashboard viewport for trusted CDP input', () => {
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.doesNotMatch(layout, /else if \(recovery\)/);
  assert.match(layout, /int width = compactPlayback \? 1 : clientWidth;/);
  assert.match(layout, /int height = compactPlayback \? 1 : clientHeight;/);
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
  assert.match(spotifyHeader, /bool hostLayoutReducedZoomApplied = false/);
  assert.match(layout, /const bool controllerChanged =/);
  assert.match(layout, /hostLayoutReducedZoomApplied != reducedZoom/);
  assert.doesNotMatch(layout, /get_ZoomFactor\(/);
});

test('single-window authentication keeps foreground repair without account badge work', () => {
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

test('lightweight Spotify styling protects player timing and progress surfaces', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /background-image: none !important/);
  assert.match(scripts, /img, picture, video, canvas/);
  assert.match(scripts, /Keep player controls, elapsed-time text and progress\/slider trees out/);
  assert.match(scripts, /data-testid\*="playback"/);
  assert.match(scripts, /data-testid\*="progress"/);
  assert.match(scripts, /role="slider"/);
  assert.match(scripts, /aria-valuenow/);
  assert.match(scripts, /\[data-testid="now-playing-bar"\]/);
  assert.match(scripts, /footer/);
  assert.doesNotMatch(scripts, /audio\s*,?\s*\{/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment/);
});

test('Spotify decorative requests are blocked inside Chromium and login is unblocked', () => {
  assert.match(spotify, /Network\.setBlockedURLs/);
  assert.match(spotify, /kSpotifyBlockedDecorativeUrls/);
  assert.match(spotify, /kSpotifyUnblockedDecorativeUrls/);
  assert.match(spotify, /SetSpotifyDecorativeResourceBlocking\(sender, target->playerPage\)/);
  assert.match(spotify, /SetSpotifyDecorativeResourceBlocking\(sender, playerPage\)/);
  assert.doesNotMatch(spotify, /AddWebResourceRequestedFilter/);
  assert.doesNotMatch(spotify, /CreateWebResourceResponse/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
});

test('Spotify trims browser UI services without disabling script or web messages', () => {
  assert.match(spotify, /put_AreDefaultScriptDialogsEnabled\(FALSE\)/);
  assert.match(spotify, /put_IsPasswordAutosaveEnabled\(FALSE\)/);
  assert.match(spotify, /put_IsGeneralAutofillEnabled\(FALSE\)/);
  assert.match(spotify, /put_IsPinchZoomEnabled\(FALSE\)/);
  assert.match(spotify, /put_IsSwipeNavigationEnabled\(FALSE\)/);
  assert.match(spotify, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
});

test('track changes prefer Spotify SPA links and retain full navigation as fallback', () => {
  assert.match(scripts, /kSpotifySpaRouteScript/);
  assert.match(scripts, /document\.querySelectorAll\('a\[href\*="\/track\/"\]'\)/);
  assert.match(scripts, /link\.click\(\)/);
  assert.match(music, /ExecuteScript\(\s*kSpotifySpaRouteScript/);
  assert.match(music, /requestedView->Navigate\(currentTrack->url\.c_str\(\)\)/);
});
