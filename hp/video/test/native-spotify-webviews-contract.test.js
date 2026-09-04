import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(
  new URL('../../native/src/spotify_webviews.cpp', import.meta.url),
  'utf8',
);
const spotifyHeader = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const spotifyPhaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const rendererPanels = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('six Spotify accounts reuse the media WebView2 user data folder', () => {
  assert.match(spotifyHeader, /kAccountCount = 6/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mediaPanel, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.doesNotMatch(spotify, /CreateCoreWebView2EnvironmentWithOptions/);
});

test('all six Spotify sessions use isolated named profiles', () => {
  assert.match(spotify, /ICoreWebView2Environment10/);
  assert.match(spotify, /CreateCoreWebView2ControllerOptions/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
});

test('Spotify foreground uses six tall hosts and background keeps 1px visible controllers alive', () => {
  assert.match(spotify, /clientWidth \/ static_cast<int>\(kAccountCount\)/);
  assert.match(spotify, /clientHeight \* 9 \/ 20/);
  assert.match(spotify, /phoneWidth \* 20 \/ 9/);
  assert.match(spotify, /kSpotifyBackgroundExtent = 1/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(spotify, /ShowWindow\(slot\.hostWindow, SW_SHOWNOACTIVATE\)/);
  assert.doesNotMatch(spotify, /SW_HIDE/);
  assert.match(
    spotify,
    /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"/,
  );
});

test('Spotify player pages reduce decorative work without hiding foreground surfaces', () => {
  assert.match(spotify, /kSpotifyLightweightScript/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /transition: none !important/);
  assert.doesNotMatch(spotify, /visibility: hidden !important/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
});

test('YouTube and TVer own the only one-hour phase cadence while Spotify uses a reconciler', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(
    rendererPanels,
    /timerId\) == kNativeMediaPhaseTimer[\s\S]*SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/,
  );
  assert.match(spotifyHeader, /void SetPodcastMode\(bool podcastMode\) noexcept/);
  assert.match(spotifyHeader, /void SetSpotifyMediaPhase\(bool podcastMode\) noexcept/);
  assert.match(
    lifecycle,
    /void SetSpotifyMediaPhase\(bool podcastMode\) noexcept[\s\S]*gSpotifyWebViews->SetPodcastMode\(podcastMode\)/,
  );
  assert.match(lifecycle, /gSpotifyWebViews->Start\(\);\s*SetSpotifyMediaPhase\(false\);/);
  assert.match(spotifyPhaseSync, /StopLegacySchedulers\(\)/);
  assert.match(spotifyPhaseSync, /KillTimer\(slot\.hostWindow, kSpotifyModeSwitchTimer\)/);
  assert.match(spotifyPhaseSync, /KillTimer\(slot\.hostWindow, kSpotifyModeTimer\)/);
  assert.match(spotifyPhaseSync, /KillTimer\(slot\.hostWindow, kSpotifyPlaybackWatchdogTimer\)/);
  assert.match(spotifyPhaseSync, /kSpotifyRobustReconcileTickMs = 2U \* 1000U/);
  assert.match(spotifyPhaseSync, /podcastMode_ = podcastMode/);
  assert.doesNotMatch(
    spotifyPhaseSync,
    /void SpotifyWebViews::SetPodcastMode[\s\S]*ToggleMode\(\)/,
  );
});

test('robust Spotify scheduler serializes six-window work and retries missed mode navigation', () => {
  assert.match(spotifyHeader, /size_t reconcileIndex_ = 0/);
  assert.match(spotifyHeader, /ULONGLONG lastModeNavigateTick = 0/);
  assert.match(spotifyHeader, /bool reconcileInFlight = false/);
  assert.match(spotifyHeader, /int unhealthyChecks = 0/);
  assert.match(spotifyPhaseSync, /reconcileIndex_\+\+ % slots_\.size\(\)/);
  assert.match(spotifyPhaseSync, /kSpotifyRobustNavigateRetryMs = 20ULL \* 1000ULL/);
  assert.match(spotifyPhaseSync, /kSpotifyRobustUnhealthyLimit = 3/);
  assert.match(spotifyPhaseSync, /SlotMatchesDesiredMode\(slot\)/);
  assert.match(spotifyPhaseSync, /NavigateSlotRobustly\(slot\)/);
  assert.match(spotifyPhaseSync, /requestedPodcastMode != podcastMode_/);
  assert.match(spotifyPhaseSync, /window\.__homePanelSpotifyEnsure = null/);
  assert.match(spotifyPhaseSync, /__homePanelSpotifyRobustMode = 'switching'/);
});

test('robust scheduler softens six-WebView startup pressure', () => {
  assert.match(spotifyPhaseSync, /kSpotifyRobustStartupStaggerMs = 1500U/);
  assert.match(spotifyPhaseSync, /KillTimer\(slot\.hostWindow, kSpotifyStartupTimer\)/);
  assert.match(
    spotifyPhaseSync,
    /SetTimer\(slot\.hostWindow, kSpotifyStartupTimer, delay, nullptr\)/,
  );
  assert.match(spotifyHeader, /bool robustSchedulerStarted_ = false/);
});

test('music phase loops the requested Spotify playlist context with robust repeat recovery', () => {
  assert.match(spotify, /5DQCO4Hv3MbVYHgyXEfx8g/);
  assert.match(spotify, /__homePanelSakuraPlaylistLoop/);
  assert.match(spotify, /ensureRepeatContext/);
  assert.match(spotifyPhaseSync, /kSpotifyRobustMusicScript/);
  assert.match(spotifyPhaseSync, /repeatState/);
  assert.match(spotifyPhaseSync, /checked === 'true'.*'context'/s);
  assert.match(spotifyPhaseSync, /checked === 'mixed'.*'one'/s);
  assert.match(spotifyPhaseSync, /enable repeat one/);
  assert.match(spotifyPhaseSync, /playlistPlayButton/);
  assert.match(spotifyPhaseSync, /window\.__homePanelSpotifyEnsure = window\.__homePanelSpotifyRobustEnsure/);
  assert.doesNotMatch(spotify, /307SI8AgVvBbNTkNrETKHW/);
  assert.doesNotMatch(spotify, /__homePanelSakuraAlternatingLoop/);
});

test('podcast phase repeatedly recovers Sakura TALKABOUT latest episode at 3x', () => {
  assert.match(spotify, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(spotify, /kSpotifyPodcastPlaybackScript/);
  assert.match(spotifyPhaseSync, /kSpotifyRobustPodcastScript/);
  assert.match(spotifyPhaseSync, /a\[href\*="\/episode\/"\]/);
  assert.match(spotifyPhaseSync, /const latest = links\[0\]/);
  assert.match(spotifyPhaseSync, /const playbackRate = 3\.0/);
  assert.match(spotifyPhaseSync, /media\.defaultPlaybackRate = playbackRate/);
  assert.match(spotifyPhaseSync, /ensureRepeatOff/);
  assert.match(spotifyPhaseSync, /media && media\.ended && onEpisode/);
  assert.match(spotifyPhaseSync, /location\.replace\(showUrl\)/);
  assert.match(spotifyPhaseSync, /latestEpisodeButton\(\)/);
});

test('legacy watchdog is disabled after startup and robust reconciler becomes the single authority', () => {
  assert.match(spotify, /kSpotifyPlaybackWatchdogTimer = 4/);
  assert.match(spotify, /playbackWatchdogIndex_\+\+ % slots_\.size\(\)/);
  assert.match(spotifyPhaseSync, /kSpotifyRobustReconcileTimer = 0x53505243/);
  assert.match(spotifyPhaseSync, /SetTimer\(host, kSpotifyRobustReconcileTimer/);
  assert.match(spotifyPhaseSync, /ReconcileTimerProc/);
  assert.match(spotifyPhaseSync, /ReconcileDesiredMode\(\)/);
  assert.match(
    spotifyPhaseSync,
    /StopLegacySchedulers\(\);[\s\S]*ArmRobustScheduler\(\)/,
  );
});

test('all six Spotify WebViews stay natively muted so media-panel audio never overlaps', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
});

test('Spotify foreground still depends on playback state reported by the robust scripts', () => {
  assert.match(spotifyHeader, /bool playing = false/);
  assert.match(spotifyHeader, /bool foreground_ = true/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(spotifyPhaseSync, /spotify:playing/);
  assert.match(spotifyPhaseSync, /spotify:not-playing/);
  assert.match(spotify, /foreground = foreground \|\| !slot\.playing/);
});

test('Spotify and media playback ignore power-saving mode while following renderer lifetime', () => {
  assert.match(lifecycle, /std::unique_ptr<SpotifyWebViews> gSpotifyWebViews/);
  assert.match(lifecycle, /gSpotifyWebViews->Start\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Shutdown\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Resize\(\)/);
  const powerSavingStart = lifecycle.indexOf('void Renderer::SetPowerSavingMode');
  const visibilityStart = lifecycle.indexOf('void Renderer::ApplyDashboardVisibility');
  assert.notEqual(powerSavingStart, -1);
  assert.notEqual(visibilityStart, -1);
  const powerSavingSection = lifecycle.slice(powerSavingStart, visibilityStart);
  assert.doesNotMatch(powerSavingSection, /gSpotifyWebViews/);
});
