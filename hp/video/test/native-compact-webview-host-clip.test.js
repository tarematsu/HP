import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadLayout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

test('Stationhead keeps 360x960 in background and expands monitor or interactive playback on the media panel', () => {
  assert.match(stationheadLayout, /CreateRectRgn\(0, 0, 1, 1\)/);
  assert.match(stationheadLayout, /SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(stationheadLayout, /kStationheadPlaybackViewportWidth = 360/);
  assert.match(stationheadLayout, /kStationheadPlaybackViewportHeight = 960/);
  assert.match(stationheadLayout, /StationheadPlaybackControllerBounds\(\)/);
  assert.match(
    stationheadLayout,
    /const bool fullPanelPlayback =[\s\S]*playbackForeground && \(monitorForeground \|\| interactivePlayback\)[\s\S]*const RECT playbackControllerBounds = fullPanelPlayback[\s\S]*RECT\{0, 0, playbackWidth, playbackHeight\}[\s\S]*StationheadPlaybackControllerBounds\(\)/,
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


test('steady-state Stationhead layout skips identical GDI clipping operations', () => {
  const begin = stationheadLayout.indexOf('void ApplyHostVisualClip(');
  const end = stationheadLayout.indexOf('HWND CreateStationheadChildHost(', begin);
  assert.ok(begin >= 0 && end > begin);
  const clip = stationheadLayout.slice(begin, end);
  assert.match(clip, /GetWindowRgnBox\(window, &current\)/);
  assert.match(clip, /if \(regionType != ERROR\) SetWindowRgn\(window, nullptr, TRUE\)/);
  assert.match(clip, /const RECT backgroundClip\{0, 0, 1, 1\}/);
  assert.match(clip, /regionType == SIMPLEREGION && EqualRect\(&current, &backgroundClip\)/);
  assert.ok(clip.indexOf('EqualRect(&current, &backgroundClip)') <
    clip.indexOf('CreateRectRgn(0, 0, 1, 1)'));
  assert.match(clip, /if \(!SetWindowRgn\(window, region, TRUE\)\) DeleteObject\(region\)/);
});
