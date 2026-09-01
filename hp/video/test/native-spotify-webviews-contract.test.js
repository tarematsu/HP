import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(
  new URL('../../native/src/spotify_webviews.cpp', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
  'utf8',
);

test('six Spotify accounts reuse the YouTube WebView2 user data folder', () => {
  assert.match(spotify, /kAccountCount = 6/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mvPanel, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.doesNotMatch(spotify, /CreateCoreWebView2EnvironmentWithOptions/);
});

test('Spotify sessions are isolated with six named profiles inside that environment', () => {
  assert.match(spotify, /ICoreWebView2Environment10/);
  assert.match(spotify, /CreateCoreWebView2ControllerOptions/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(spotify, /put_IsInPrivateModeEnabled\(FALSE\)/);
});

test('login foreground uses six tall side-by-side WebView hosts', () => {
  assert.match(spotify, /clientWidth \/ static_cast<int>\(kAccountCount\)/);
  assert.match(spotify, /clientHeight \* 9 \/ 20/);
  assert.match(spotify, /phoneWidth \* 20 \/ 9/);
  assert.match(spotify, /SW_SHOWNOACTIVATE/);
  assert.match(spotify, /SW_HIDE/);
  assert.match(spotify, /accounts\.spotify\.com/);
  assert.match(spotify, /RecomputeAuthenticationForeground\(\)/);
});

test('Spotify pool follows renderer lifetime and power saving', () => {
  assert.match(lifecycle, /std::unique_ptr<SpotifyWebViews> gSpotifyWebViews/);
  assert.match(lifecycle, /gSpotifyWebViews->Start\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Shutdown\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Resize\(\)/);
});
