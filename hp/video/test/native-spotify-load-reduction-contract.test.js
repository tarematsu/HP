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

test('Spotify WebViews serialize startup without UI-thread blocking or polling timers', () => {
  assert.match(spotify, /CreateController\(slots_\[0\]\)/);
  assert.match(spotifyHeader, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(spotifyHeader, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(schedule, /startupReady/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phase, /slot\.nextRecoveryTick/);
  assert.doesNotMatch(schedule, /SimpleSpotifyScheduledIndex|kSpotifySimpleSteadyTurnMs/);
  assert.doesNotMatch(spotify, /kSpotifyStartupTimer|kSpotifyStartupStaggerMs|Sleep\(/);
  assert.doesNotMatch(phase + schedule + spotify, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
});

test('Spotify layout parks healthy players in a smaller offscreen viewport', () => {
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 160/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 90/);
  assert.match(layout, /const bool positionChanged =/);
  assert.match(layout, /const bool sizeChanged =/);
  assert.match(layout, /const bool zOrderChanged =/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.doesNotMatch(layout, /ShowWindow\(slot\.hostWindow/);
});

test('healthy music WebViews stay visible while retaining compact host geometry', () => {
  assert.match(layout, /CurrentMusicTrack\(slot\)/);
  assert.match(layout, /const bool lowPowerPlayback =/);
  assert.match(layout, /put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(lowPowerPlayback \? FALSE : TRUE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
});

test('Spotify layout avoids redundant controller geometry COM calls', () => {
  assert.match(spotifyHeader, /ICoreWebView2Controller\* hostLayoutController = nullptr/);
  assert.match(spotifyHeader, /bool hostLayoutReducedZoomApplied = false/);
  assert.match(layout, /const bool controllerChanged =/);
  assert.match(layout, /hostLayoutReducedZoomApplied != reducedZoom/);
  assert.doesNotMatch(layout, /get_ZoomFactor\(/);
});

test('Spotify authentication badge bootstrap runs once per navigation generation', () => {
  assert.match(spotifyHeader, /ULONGLONG authenticationBadgeTick = 0/);
  assert.match(layout, /if \(slot\.authenticationBadgeTick != 0\) return/);
  assert.match(layout, /slot\.authenticationBadgeTick = 1/);
  assert.doesNotMatch(layout, /kSpotifyAuthenticationBadgeRefreshMs/);
  assert.match(spotify, /target->authenticationBadgeTick = 0/);
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

test('lightweight Spotify styling is fixed CSS with no MutationObserver', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /background-image: none !important/);
  assert.match(scripts, /img, picture, video, canvas/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment/);
});

test('Spotify player pages block only images and fonts while auth pages stay unfiltered', () => {
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.match(spotify, /!target->playerPage \|\| !target->environment/);
  assert.match(spotify, /CreateWebResourceResponse\(\s*nullptr, 204, L"No Content"/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
});
