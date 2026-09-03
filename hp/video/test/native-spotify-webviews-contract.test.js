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

test('all six Spotify sessions use isolated named profiles', () => {
  assert.match(spotify, /ICoreWebView2Environment10/);
  assert.match(spotify, /CreateCoreWebView2ControllerOptions/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
  assert.doesNotMatch(spotify, /if \(target->index == 0\)/);
  assert.doesNotMatch(
    spotify,
    /environment->CreateCoreWebView2Controller\(\s*target->hostWindow/,
  );
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
  assert.match(spotify, /__homePanelSpotifyAccount/);
});

test('Spotify player pages suppress decorative rendering and downloads only', () => {
  assert.match(spotify, /kSpotifyLightweightScript/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /transition: none !important/);
  assert.match(spotify, /canvas/);
  assert.match(
    spotify,
    /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/,
  );
  assert.match(
    spotify,
    /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/,
  );
  assert.match(spotify, /CreateWebResourceResponse\(\s*nullptr, 204, L"No Content"/);
  assert.match(spotify, /!target->playerPage \|\| !target->environment/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
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
  assert.match(spotify, /let targetStarted = false/);
  assert.match(spotify, /const targetPlayButton = \(\) =>/);
  assert.match(
    spotify,
    /if \(!targetStarted\)[\s\S]*targetPlayButton\(\)[\s\S]*target\.click\(\)[\s\S]*targetStarted = true[\s\S]*report\(false\)/,
  );
  assert.match(spotify, /window\.__homePanelSpotifyEnsure = ensure/);
});

test('podcast phase starts Sakura TALKABOUT from the latest episode and keeps 3x playback', () => {
  assert.match(spotify, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(spotify, /kSpotifyPodcastPlaybackScript/);
  assert.match(spotify, /a\[href\*="\/episode\/"\]/);
  assert.match(spotify, /const latest = links\[0\]/);
  assert.match(spotify, /const onEpisode = location\.pathname\.startsWith\('\/episode\/'\)/);
  assert.match(spotify, /const recoveryButton = onShow => playerControl\(\)/);
  assert.match(spotify, /disableRepeat\(\)/);
  assert.match(spotify, /const playbackRate = 3\.0/);
  assert.match(spotify, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(spotify, /media\.defaultPlaybackRate = playbackRate/);
  assert.match(
    spotify,
    /if \(media\.playbackRate !== playbackRate\) media\.playbackRate = playbackRate/,
  );
  assert.match(spotify, /window\.__homePanelSpotifyEnsure = ensure/);
  assert.doesNotMatch(
    spotify,
    /if \(!location\.pathname\.endsWith\(showPath\)\)[\s\S]*location\.replace\(showUrl\)/,
  );
});

test('one native round-robin timer verifies all six Spotify playback states', () => {
  assert.match(spotify, /kSpotifyPlaybackWatchdogTimer = 4/);
  assert.match(spotify, /kSpotifyPlaybackWatchdogTickMs = 2U \* 1000U/);
  assert.match(spotifyHeader, /size_t playbackWatchdogIndex_ = 0/);
  assert.match(
    spotify,
    /playbackWatchdogIndex_\+\+ % slots_\.size\(\)/,
  );
  assert.match(spotify, /ExecuteScript\(kSpotifyWatchdogScript, nullptr\)/);
  assert.match(
    spotify,
    /wparam == kSpotifyPlaybackWatchdogTimer[\s\S]*RunPlaybackWatchdog\(\)/,
  );
  assert.doesNotMatch(spotify, /window\.setInterval\(ensure/);
  assert.equal((spotify.match(/const stallLimit = 2/g) || []).length, 2);
  assert.equal(
    (spotify.match(/!media\.paused && !media\.ended && media\.readyState >= 2/g) || []).length,
    2,
  );
  assert.equal(
    (spotify.match(/Math\.abs\(currentTime - lastTime\) >= 0\.5/g) || []).length,
    2,
  );
  assert.equal((spotify.match(/stalledChecks < stallLimit/g) || []).length, 2);
  assert.equal((spotify.match(/if \(lastReported === playing\) return/g) || []).length, 2);
});

test('all six Spotify WebViews stay natively muted so media-panel audio never overlaps', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(target->webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
  assert.doesNotMatch(spotify, /amazonPodcastMode_/);
});

test('Spotify foreground depends on six playback states reported by the shared watchdog', () => {
  assert.match(spotifyHeader, /bool playing = false/);
  assert.match(spotifyHeader, /bool foreground_ = true/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(spotify, /spotify:playing/);
  assert.match(spotify, /spotify:not-playing/);
  assert.match(spotify, /add_WebMessageReceived/);
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
  assert.doesNotMatch(powerSavingSection, /DestroyWindow/);
});
