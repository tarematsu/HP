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
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
  'utf8',
);

test('six Spotify accounts reuse the YouTube WebView2 user data folder', () => {
  assert.match(spotifyHeader, /kAccountCount = 6/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mvPanel, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.doesNotMatch(spotify, /CreateCoreWebView2EnvironmentWithOptions/);
});

test('amazon shares YouTube default profile while the other five Spotify sessions stay isolated', () => {
  assert.match(spotify, /if \(target->index == 0\)/);
  assert.match(
    spotify,
    /environment->CreateCoreWebView2Controller\(\s*target->hostWindow, controllerReady\.Get\(\)\)/,
  );
  assert.match(spotify, /ICoreWebView2Environment10/);
  assert.match(spotify, /CreateCoreWebView2ControllerOptions/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(spotify, /put_IsInPrivateModeEnabled\(FALSE\)/);
});

test('playback attention foreground uses six tall side-by-side WebView hosts', () => {
  assert.match(spotify, /clientWidth \/ static_cast<int>\(kAccountCount\)/);
  assert.match(spotify, /clientHeight \* 9 \/ 20/);
  assert.match(spotify, /phoneWidth \* 20 \/ 9/);
  assert.match(spotify, /SW_SHOWNOACTIVATE/);
  assert.match(spotify, /SW_HIDE/);
  assert.match(spotify, /accounts\.spotify\.com/);
  assert.match(spotify, /RecomputeForeground\(\)/);
});

test('foreground Spotify WebViews show account names from left to right', () => {
  assert.match(
    spotify,
    /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"/,
  );
  assert.match(spotify, /__homePanelSpotifyAccount/);
  assert.match(spotify, /position:fixed;left:8px;top:8px/);
  assert.match(spotify, /BuildSpotifyPanelLabelScript\(target->index\)/);
});

test('Spotify normally keeps Lonesome rabbit playing on repeat one', () => {
  assert.match(spotify, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.match(
    spotify,
    /continue=https%3A%2F%2Fopen\.spotify\.com%2Falbum%2F2f2Ik9JeinFVWZuFb3i35b/,
  );
  assert.match(spotify, /button\[data-testid="play-button"\]/);
  assert.match(spotify, /control-button-repeat/);
  assert.match(spotify, /aria-checked/);
  assert.match(spotify, /mixed/);
  assert.match(spotify, /kSpotifyPlaybackScript/);
});

test('amazon switches to the requested podcast during the MV pause period', () => {
  assert.match(spotifyHeader, /void SetAmazonPodcastMode\(bool enabled\) noexcept/);
  assert.match(spotifyHeader, /void SetSpotifyAmazonPodcastMode\(bool enabled\) noexcept/);
  assert.match(spotify, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(spotify, /kSpotifyPodcastPlaybackScript/);
  assert.match(spotify, /enabled \? kSpotifyPodcastUrl : kSpotifyAlbumUrl/);
  assert.match(spotify, /target->index == 0 && amazonPodcastMode_/);
  assert.match(composition, /SetSpotifyAmazonPodcastMode/);
  assert.match(composition, /kNativeMvRandomActionTimerForSpotify = 0x4D560001/);
  assert.match(composition, /kNativeMvResumeDelayFloorMsForSpotify = 60U \* 60U \* 1000U/);
});

test('only the amazon podcast is unmuted; normal Spotify music remains host-muted', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(muted \? TRUE : FALSE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview, !amazonPodcast\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(target->webview, !amazonPodcast\)/);
  assert.match(spotify, /if \(!enabled\) SetSpotifyOutputMuted\(amazon\.webview, true\)/);
  assert.match(spotify, /playing = label\.includes\('pause'\)/);
  assert.doesNotMatch(spotify, /\.muted\s*=\s*true/);
  assert.doesNotMatch(spotify, /\.volume\s*=\s*0/);
});

test('Spotify foreground depends only on all six playback states checked every minute', () => {
  assert.match(spotifyHeader, /bool playing = false/);
  assert.match(spotifyHeader, /bool foreground_ = true/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(spotify, /spotify:playing/);
  assert.match(spotify, /spotify:not-playing/);
  assert.match(spotify, /add_WebMessageReceived/);
  assert.match(spotify, /foreground = foreground \|\| !slot\.playing/);
  assert.match(spotify, /setInterval\(ensure, 60000\)/);
  assert.doesNotMatch(spotifyHeader, /authNavigation/);
  assert.match(spotify, /target->playing = false/);
  assert.match(spotify, /remove_WebMessageReceived/);
});

test('Spotify and MV both ignore power-saving mode while following renderer lifetime', () => {
  assert.match(lifecycle, /std::unique_ptr<SpotifyWebViews> gSpotifyWebViews/);
  assert.match(lifecycle, /gSpotifyWebViews->Start\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Shutdown\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Resize\(\)/);
  assert.doesNotMatch(lifecycle, /StopNativeMvPlayback/);

  const powerSavingStart = lifecycle.indexOf('void Renderer::SetPowerSavingMode');
  const visibilityStart = lifecycle.indexOf('void Renderer::ApplyDashboardVisibility');
  assert.notEqual(powerSavingStart, -1);
  assert.notEqual(visibilityStart, -1);
  const powerSavingSection = lifecycle.slice(powerSavingStart, visibilityStart);
  assert.doesNotMatch(powerSavingSection, /gSpotifyWebViews/);
  assert.doesNotMatch(powerSavingSection, /DestroyWindow/);
  assert.match(lifecycle, /const bool mvReady = EnsureNativeStaticWindows\(\)/);
});
