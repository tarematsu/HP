import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourcePart = (name) => readFileSync(
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
  assert.match(phase, /kSpotifyQueueRetryMs = 4ULL \* 1000ULL/);
  assert.match(phase, /slot\.lastTimedReconcileTick \+ kSpotifyQueueRetryMs/);
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
  assert.match(layout, /if \(!positionChanged\) flags \|= SWP_NOMOVE/);
  assert.match(layout, /if \(!sizeChanged\) flags \|= SWP_NOSIZE/);
  assert.match(layout, /if \(!zOrderChanged\) flags \|= SWP_NOZORDER/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.doesNotMatch(layout, /ShowWindow\(slot\.hostWindow/);
  assert.doesNotMatch(layout, /BeginDeferWindowPos|EndDeferWindowPos/);
});

test('healthy music WebViews suppress rendering while auth and recovery remain visible', () => {
  assert.match(layout, /CurrentMusicTrack\(slot\)/);
  assert.doesNotMatch(layout, /TimedSpotifyTarget|shuffleOffVerified|repeatOffVerified|PlaybackModeGuard/);
  assert.match(
    layout,
    /const bool lowPowerPlayback =[\s\S]*SlotStateIsHealthy\(slot\.state\)[\s\S]*slot\.playerPage[\s\S]*!slot\.loginPage[\s\S]*CurrentMusicTrack\(slot\)/,
  );
  assert.match(layout, /put_IsVisible\(lowPowerPlayback \? FALSE : TRUE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
});

test('Spotify layout avoids redundant controller geometry COM calls', () => {
  assert.match(spotifyHeader, /ICoreWebView2Controller\* hostLayoutController = nullptr/);
  assert.match(spotifyHeader, /bool hostLayoutReducedZoomApplied = false/);
  assert.match(layout, /const bool controllerChanged =/);
  assert.doesNotMatch(layout, /controllerChanged\)[\s\S]{0,220}put_Bounds/);
  assert.match(
    layout,
    /if \(positionChanged \|\| controllerChanged\)[\s\S]*NotifyParentWindowPositionChanged\(\)/,
  );
  assert.doesNotMatch(layout, /get_ZoomFactor\(/);
  assert.match(layout, /hostLayoutReducedZoomApplied != reducedZoom/);
});

test('Spotify authentication badge bootstrap runs once per navigation generation', () => {
  assert.match(spotifyHeader, /ULONGLONG authenticationBadgeTick = 0/);
  assert.match(layout, /if \(slot\.authenticationBadgeTick != 0\) return/);
  assert.match(layout, /slot\.authenticationBadgeTick = 1/);
  assert.doesNotMatch(layout, /kSpotifyAuthenticationBadgeRefreshMs/);
  assert.match(spotify, /target->authenticationBadgeTick = 0/);
});

test('steady authentication layout repairs z-order only when it is actually lost', () => {
  assert.match(
    layout,
    /!layoutChanged && GetWindow\(slot\.hostWindow, GW_HWNDPREV\) != nullptr/,
  );
  assert.match(layout, /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE/);
});

test('each Spotify scheduler pass performs at most one host layout refresh', () => {
  const refreshes = schedule.match(/RefreshSpotifyHostLayout\(\);/g) || [];
  assert.equal(refreshes.length, 1);
  assert.match(
    schedule,
    /schedulerCursor_ = selected;[\s\S]*Slot& slot = slots_\[selected\];[\s\S]*RefreshSpotifyHostLayout\(\);/,
  );
  assert.match(schedule, /const auto asyncIdle/);
});

test('scheduler state is minimal and does not duplicate slot state', () => {
  assert.match(spotifyHeader, /size_t schedulerCursor_ = 0/);
  assert.match(spotifyHeader, /std::atomic<bool> schedulerWakePosted_\{false\}/);
  assert.doesNotMatch(spotifyHeader, /staggerSlotStartTick_|staggerSlotValidated_|timedCatalogIndex|timedRandomFIndex|timedMiddleOrder|TimedSpotifyTarget|timedPlaybackStartTick/);
});

test('lightweight Spotify styling is a fixed bootstrap script with no MutationObserver', () => {
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
  assert.match(spotify, /remove_WebResourceRequested/);
  assert.match(spotifyHeader, /EventRegistrationToken webResourceRequestedToken/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST/);
});