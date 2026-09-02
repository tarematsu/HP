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

test('amazon shares the default profile while the other five Spotify sessions stay isolated', () => {
  assert.match(spotify, /if \(target->index == 0\)/);
  assert.match(
    spotify,
    /environment->CreateCoreWebView2Controller\(\s*target->hostWindow, ready\.Get\(\)\)/,
  );
  assert.match(spotify, /ICoreWebView2Environment10/);
  assert.match(spotify, /CreateCoreWebView2ControllerOptions/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
});

test('Spotify foreground uses six tall side-by-side WebView hosts with account labels', () => {
  assert.match(spotify, /clientWidth \/ static_cast<int>\(kAccountCount\)/);
  assert.match(spotify, /clientHeight \* 9 \/ 20/);
  assert.match(spotify, /phoneWidth \* 20 \/ 9/);
  assert.match(spotify, /SW_SHOWNOACTIVATE/);
  assert.match(spotify, /SW_HIDE/);
  assert.match(
    spotify,
    /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"/,
  );
  assert.match(spotify, /__homePanelSpotifyAccount/);
});

test('all six accounts alternate Lonesome rabbit and Sakura TALKABOUT every hour with staggered switches', () => {
  assert.match(spotify, /kSpotifyModeTimer = 2/);
  assert.match(spotify, /kSpotifyModeSwitchTimer = 3/);
  assert.match(spotify, /kSpotifyModePhaseMs = 60U \* 60U \* 1000U/);
  assert.match(spotify, /kSpotifyModeStaggerMs = 10U \* 1000U/);
  assert.match(spotifyHeader, /bool podcastMode_ = false/);
  assert.match(
    spotify,
    /void SpotifyWebViews::ToggleMode\(\) noexcept[\s\S]*podcastMode_ = !podcastMode_;[\s\S]*for \(Slot& slot : slots_\)[\s\S]*slot\.index == 0[\s\S]*NavigateSlotToCurrentMode\(slot\)[\s\S]*slot\.index\) \* kSpotifyModeStaggerMs[\s\S]*SetTimer\(slot\.hostWindow, kSpotifyModeSwitchTimer, delay, nullptr\)[\s\S]*ArmModeTimer\(\)/,
  );
  assert.match(
    spotify,
    /wparam == kSpotifyModeSwitchTimer[\s\S]*KillTimer\(hwnd, kSpotifyModeSwitchTimer\)[\s\S]*NavigateSlotToCurrentMode\(\*slot\)/,
  );
  assert.match(
    spotify,
    /NavigateSlotToCurrentMode\(Slot& slot\)[\s\S]*Navigate\(podcastMode_ \? kSpotifyPodcastUrl : kSpotifyAlbumUrl\)/,
  );
  assert.match(spotify, /KillTimer\(slot\.hostWindow, kSpotifyModeSwitchTimer\)/);
  assert.doesNotMatch(spotifyHeader, /SetAmazonPodcastMode/);
  assert.doesNotMatch(spotify, /SetSpotifyAmazonPodcastMode/);
});

test('music phase keeps the requested track release on repeat one', () => {
  assert.match(spotify, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.match(spotify, /kSpotifyPlaybackScript/);
  assert.match(spotify, /control-button-repeat/);
  assert.match(spotify, /aria-checked.*mixed/s);
  assert.match(spotify, /window\.setInterval\(ensure, 60000\)/);
});

test('podcast phase starts Sakura TALKABOUT from the latest episode and keeps 3x playback', () => {
  assert.match(spotify, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(spotify, /kSpotifyPodcastPlaybackScript/);
  assert.match(spotify, /a\[href\*="\/episode\/"\]/);
  assert.match(spotify, /const latest = links\[0\]/);
  assert.match(spotify, /const onEpisode = location\.pathname\.startsWith\('\/episode\/'\)/);
  assert.match(spotify, /const playButton = onShow \? latestEpisodeButton\(\)/);
  assert.match(spotify, /disableRepeat\(\)/);
  assert.match(spotify, /const playbackRate = 3\.0/);
  assert.match(spotify, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(spotify, /media\.defaultPlaybackRate = playbackRate/);
  assert.match(
    spotify,
    /if \(media\.playbackRate !== playbackRate\) media\.playbackRate = playbackRate/,
  );
  assert.match(spotify, /window\.setInterval\(ensure, 5000\)/);
  assert.doesNotMatch(
    spotify,
    /if \(!location\.pathname\.endsWith\(showPath\)\)[\s\S]*location\.replace\(showUrl\)/,
  );
});

test('all six Spotify WebViews stay natively muted so media-panel audio never overlaps', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(target->webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
  assert.doesNotMatch(spotify, /amazonPodcastMode_/);
});

test('Spotify foreground depends on six playback states checked periodically', () => {
  assert.match(spotifyHeader, /bool playing = false/);
  assert.match(spotifyHeader, /bool foreground_ = true/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(spotify, /spotify:playing/);
  assert.match(spotify, /spotify:not-playing/);
  assert.match(spotify, /add_WebMessageReceived/);
  assert.match(spotify, /foreground = foreground \|\| !slot\.playing/);
  assert.match(spotify, /setInterval\(ensure, 60000\)/);
  assert.match(spotify, /setInterval\(ensure, 5000\)/);
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
  assert.doesNotMatch(powerSavingSection, /DestroyWindow/);
});
