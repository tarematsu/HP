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

test('YouTube and TVer own the only one-hour phase cadence used by Spotify', () => {
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
  assert.match(
    spotifyPhaseSync,
    /stopLegacyModeTimer\(\);[\s\S]*if \(podcastMode_ == podcastMode\) return;[\s\S]*ToggleMode\(\);[\s\S]*stopLegacyModeTimer\(\);/,
  );
  assert.match(spotifyPhaseSync, /KillTimer\(host, kSpotifyModeTimer\)/);
  assert.match(spotify, /kSpotifyModeStaggerMs = 10U \* 1000U/);
});

test('music phase loops the requested Spotify playlist context', () => {
  assert.match(spotify, /5DQCO4Hv3MbVYHgyXEfx8g/);
  assert.match(spotify, /__homePanelSakuraPlaylistLoop/);
  assert.match(spotify, /ensureRepeatContext/);
  assert.match(spotify, /aria-checked.*true/s);
  assert.match(spotify, /window\.__homePanelSpotifyEnsure = ensure/);
  assert.doesNotMatch(spotify, /307SI8AgVvBbNTkNrETKHW/);
  assert.doesNotMatch(spotify, /__homePanelSakuraAlternatingLoop/);
});

test('podcast phase starts Sakura TALKABOUT from the latest episode and keeps 3x playback', () => {
  assert.match(spotify, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(spotify, /kSpotifyPodcastPlaybackScript/);
  assert.match(spotify, /a\[href\*="\/episode\/"\]/);
  assert.match(spotify, /const latest = links\[0\]/);
  assert.match(spotify, /const playbackRate = 3\.0/);
  assert.match(spotify, /media\.defaultPlaybackRate = playbackRate/);
  assert.match(spotify, /window\.__homePanelSpotifyEnsure = ensure/);
});

test('one native round-robin timer verifies all six Spotify playback states', () => {
  assert.match(spotify, /kSpotifyPlaybackWatchdogTimer = 4/);
  assert.match(spotify, /kSpotifyPlaybackWatchdogTickMs = 2U \* 1000U/);
  assert.match(spotifyHeader, /size_t playbackWatchdogIndex_ = 0/);
  assert.match(spotify, /playbackWatchdogIndex_\+\+ % slots_\.size\(\)/);
  assert.match(spotify, /ExecuteScript\(kSpotifyWatchdogScript, nullptr\)/);
  assert.equal((spotify.match(/const stallLimit = 2/g) || []).length, 2);
});

test('all six Spotify WebViews stay natively muted so media-panel audio never overlaps', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
});

test('Spotify foreground depends on six playback states reported by the shared watchdog', () => {
  assert.match(spotifyHeader, /bool playing = false/);
  assert.match(spotifyHeader, /bool foreground_ = true/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(spotify, /spotify:playing/);
  assert.match(spotify, /spotify:not-playing/);
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
