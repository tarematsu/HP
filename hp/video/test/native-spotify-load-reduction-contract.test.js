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
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);

test('Spotify WebViews serialize startup without UI-thread blocking or legacy timer rewriting', () => {
  assert.match(spotify, /CreateController\(slots_\[0\]\)/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed\)/);
  assert.doesNotMatch(spotify, /kSpotifyStartupTimer|kSpotifyStartupStaggerMs|Sleep\(/);
});

test('only the recovery owner gets a large viewport while other controllers stay alive at 1x1', () => {
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(spotify, /ShowWindow\(slot\.hostWindow, SW_SHOWNOACTIVATE\)/);
  assert.match(spotify, /int width = 1;\s*int height = 1/);
  assert.match(spotify, /const bool recovery = active && !authentication && !slot\.playing/);
  assert.match(spotify, /x = client\.right \+ 32/);
  assert.match(spotify, /width = activeWidth;\s*height = activeHeight/);
  assert.doesNotMatch(spotify, /SW_HIDE|controller->Close\(\)[\s\S]{0,120}!slot\.playing/);
  assert.match(
    spotify,
    /if \(batch\) EndDeferWindowPos\(batch\);[\s\S]*GetClientRect\(slot\.hostWindow, &bounds\);[\s\S]*put_Bounds\(bounds\);[\s\S]*NotifyParentWindowPositionChanged\(\)/,
  );
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
