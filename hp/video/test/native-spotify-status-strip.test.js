import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const reconcile = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');

test('ozeki is disabled by constructing exactly five Spotify slots', () => {
  assert.match(header, /kSpotifyActiveAccountCount = 5/);
  assert.match(header, /kAccountCount = kSpotifyActiveAccountCount/);
  assert.match(scripts, /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata"/);
  assert.doesNotMatch(scripts, /ozeki/i);
});

test('playback status uses existing start and resume events without adding a Spotify poller', () => {
  assert.match(header, /SYSTEMTIME playbackConfirmedAt/);
  assert.match(header, /bool playbackConfirmed = false/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(rotation, /target->playbackConfirmed = true/);
  assert.match(rotation, /slot\.playbackConfirmed = false/);
  assert.doesNotMatch(rotation, /SetTimer|CreateThreadpoolTimer/);
  assert.match(lifecycle, /GetSpotifyPlaybackStatuses\(\) noexcept/);
});

test('an already-playing target is handed back to the existing media observer for confirmation', () => {
  assert.match(reconcile, /playing: true, media: active/);
  assert.match(reconcile, /__homePanelSpotifyMediaObserverRuntime/);
  assert.match(reconcile, /runtime\.scheduleTargetChecks\(mediaState\.media\)/);
  assert.doesNotMatch(reconcile, /setInterval|SetTimer|CreateThreadpoolTimer/);
});

test('YouTube and TVer reserve a compact five-column Spotify status strip', () => {
  assert.match(hostWindow, /kNativeSpotifyStatusHeight = 56/);
  assert.match(hostWindow, /GetSpotifyPlaybackStatuses\(\)/);
  assert.match(hostWindow, /heading\.append\(L"  確認 "\)/);
  assert.match(hostWindow, /statuses\.size\(\)/);
  assert.match(hostWindow, /RECT statusBounds = bounds/);
  assert.match(hostWindow, /RECT videoBounds = bounds/);
  assert.match(hostWindow, /videoBounds\.top =/);
  assert.match(hostWindow, /kNativeSpotifyStatusRefreshMs = 5U \* 1000U/);
});
