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

test('Spotify WebViews stagger startup without blocking the UI thread', () => {
  assert.match(spotify, /kSpotifyStartupStaggerMs = 400/);
  assert.match(spotify, /SetTimer\(slot\.hostWindow, kSpotifyStartupTimer, delay, nullptr\)/);
  assert.match(spotify, /WM_TIMER && wparam == kSpotifyStartupTimer/);
  assert.match(spotify, /KillTimer\(hwnd, kSpotifyStartupTimer\)/);
  assert.doesNotMatch(spotify, /Sleep\(/);
});

test('background Spotify playback stays visible at 1x1 and keeps controllers alive', () => {
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(spotify, /ShowWindow\(slot\.hostWindow, SW_SHOWNOACTIVATE\)/);
  assert.match(spotify, /const int width = foreground \? phoneWidth : kSpotifyBackgroundExtent/);
  assert.match(spotify, /const int height = foreground \? phoneHeight : kSpotifyBackgroundExtent/);
  assert.doesNotMatch(spotify, /if \(!foreground\)[\s\S]{0,300}controller->Close\(\)/);
  assert.match(
    spotify,
    /if \(batch\) EndDeferWindowPos\(batch\);[\s\S]*GetClientRect\(slot\.hostWindow, &bounds\);[\s\S]*slot\.controller->put_Bounds\(bounds\);[\s\S]*slot\.controller->NotifyParentWindowPositionChanged\(\)/,
  );
});

test('lightweight Spotify CSS does not blank foreground player surfaces', () => {
  assert.doesNotMatch(spotify, /canvas,\s*\[data-testid="cover-art-image"\]/);
  assert.doesNotMatch(spotify, /visibility: hidden !important/);
});

test('Spotify player pages block only images and fonts while auth pages stay unfiltered', () => {
  assert.match(
    spotify,
    /AddWebResourceRequestedFilter\(\s*L"\*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE\)/,
  );
  assert.match(
    spotify,
    /AddWebResourceRequestedFilter\(\s*L"\*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT\)/,
  );
  assert.match(spotify, /add_WebResourceRequested/);
  assert.match(spotify, /!target->playerPage \|\| !target->environment/);
  assert.match(spotify, /CreateWebResourceResponse\(\s*nullptr, 204, L"No Content"/);
  assert.match(spotify, /target->playerPage = IsSpotifyPlayerUri\(rawUri\)/);
  assert.match(spotify, /remove_WebResourceRequested/);
  assert.match(spotifyHeader, /EventRegistrationToken webResourceRequestedToken/);
  assert.match(spotifyHeader, /ComPtr<ICoreWebView2Environment> environment/);

  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST/);
});
