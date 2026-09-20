import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadLayout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const spotifyLayout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);

test('Stationhead keeps 360x960 in background and expands only the selected monitor viewport', () => {
  assert.match(stationheadLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(stationheadLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(stationheadLayout, /kStationheadPlaybackViewportWidth = 360/);
  assert.match(stationheadLayout, /kStationheadPlaybackViewportHeight = 960/);
  assert.match(stationheadLayout, /StationheadPlaybackControllerBounds\(\)/);
  assert.match(
    stationheadLayout,
    /const RECT playbackControllerBounds = monitorForeground[\s\S]*RECT\{0, 0, playbackWidth, playbackHeight\}[\s\S]*StationheadPlaybackControllerBounds\(\)/,
  );
  assert.doesNotMatch(stationheadLayout, /kStationheadCompactPlayback|compactPlayback|useCompactPlayback/);
  assert.match(stationheadLayout, /ApplyHostVisualClip\(hostWindow, playbackForeground\)/);
  assert.match(stationheadLayout, /ApplyHostVisualClip\(authHostWindow, showAuth\)/);
});

test('Stationhead releases the empty auth host after completed authorization', () => {
  assert.match(
    stationheadLayout,
    /!spotifyAuthorization_ && !authController_[\s\S]*authPendingUrl_\.empty\(\)[\s\S]*DestroyWindow\(authHostWindow_\)[\s\S]*authHostWindow_ = nullptr/,
  );
  assert.match(stationheadLayout, /EnsureAuthHostWindow\(\)/);
});

test('Spotify keeps background hosts clipped and Monitor S removes all five playback clips', () => {
  assert.match(spotifyLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(spotifyLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(spotifyLayout, /const bool gridForeground = gSpotifyMonitorGridVisible && !loginPage/);
  assert.match(spotifyLayout, /ServiceMonitorTileBounds\(client, i \+ 1\)/);
  assert.match(
    spotifyLayout,
    /ApplySpotifyHostVisualClip\([\s\S]*authentication \|\| monitorForeground \|\| gridForeground/,
  );
});
