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

test('Stationhead keeps a full internal viewport while normal display is clipped to 1x1', () => {
  assert.match(stationheadLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(stationheadLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(stationheadLayout, /const RECT playbackHostBounds = surfaceBounds/);
  assert.match(stationheadLayout, /const RECT playbackControllerBounds\{0, 0, playbackWidth, playbackHeight\}/);
  assert.match(stationheadLayout, /ApplyHostVisualClip\(hostWindow, showPlayback\)/);
  assert.match(stationheadLayout, /ApplyHostVisualClip\(authHostWindow, showAuth\)/);
});

test('Spotify keeps a full internal viewport while only authentication is fully visible', () => {
  assert.match(spotifyLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(spotifyLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(spotifyLayout, /const int width = std::max\(1L, client\.right - client\.left\)/);
  assert.match(spotifyLayout, /const int height = std::max\(1L, client\.bottom - client\.top\)/);
  assert.match(spotifyLayout, /ApplySpotifyHostVisualClip\(slot\.hostWindow, authentication\)/);
  assert.doesNotMatch(spotifyLayout, /ApplySpotifyHostVisualClip\(slot\.hostWindow, monitorForeground_\)/);
});
