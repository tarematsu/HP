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

test('Stationhead compacts only stable background playback and Monitor B restores full viewport', () => {
  assert.match(stationheadLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(stationheadLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(stationheadLayout, /kStationheadCompactPlaybackWidth = 320/);
  assert.match(stationheadLayout, /kStationheadCompactPlaybackHeight = 180/);
  assert.match(stationheadLayout, /kStationheadCompactPlaybackStabilityMs = 15'000/);
  assert.match(stationheadLayout, /PlaybackControllerBounds\(playbackHostBounds, useCompactPlayback\)/);
  assert.match(stationheadLayout, /compactPlayback && !playbackForeground && !showAuth && !hidePlayback/);
  assert.match(stationheadLayout, /audioLossState_ == L"playing"/);
  assert.match(stationheadLayout, /!monitorForeground/);
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

test('Spotify keeps a full internal viewport and Monitor C/D remove the selected slot clip', () => {
  assert.match(spotifyLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(spotifyLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(spotifyLayout, /const int width = std::max\(1L, client\.right - client\.left\)/);
  assert.match(spotifyLayout, /const int height = std::max\(1L, client\.bottom - client\.top\)/);
  assert.match(spotifyLayout, /const bool monitorForeground =\s*static_cast<int>\(i\) == monitorForegroundSlot_/);
  assert.match(spotifyLayout, /ApplySpotifyHostVisualClip\([\s\S]*authentication \|\| monitorForeground\)/);
});
