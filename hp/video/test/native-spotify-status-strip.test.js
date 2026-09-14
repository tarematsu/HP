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
const musicTarget = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');

test('amazon is reserved for Stationhead and four Spotify slots remain', () => {
  assert.match(header, /kSpotifyProfileFirstAccountNumber = 2/);
  assert.match(header, /kSpotifyActiveAccountCount = 4/);
  assert.match(header, /kAccountCount = kSpotifyActiveAccountCount/);
  assert.match(scripts, /L"yuukiar", L"ten", L"nagi", L"hinata"/);
  assert.doesNotMatch(scripts, /amazon|ozeki/i);
});

test('playback status uses start/resume events with an already-playing fallback and no new poller', () => {
  assert.match(header, /SYSTEMTIME playbackConfirmedAt/);
  assert.match(header, /bool playbackConfirmed = false/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(rotation, /target->playbackConfirmed = true/);
  assert.match(rotation, /slot\.playbackConfirmed = false/);
  assert.doesNotMatch(rotation, /SetTimer|CreateThreadpoolTimer/);
  assert.match(lifecycle, /GetSpotifyPlaybackStatuses\(\) noexcept/);

  const confirmedBranch = musicTarget.match(
    /if \(json && std::wstring_view\(json\) == L"true"\) \{([\s\S]*?)\n            \}/,
  )?.[1] ?? '';
  assert.match(confirmedBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(confirmedBranch, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(confirmedBranch, /target->playbackConfirmed = true/);
  assert.match(
    confirmedBranch,
    /SetMusicCompletionDeadline\(\*target, callbackNow, 0, false\)/,
  );
  assert.doesNotMatch(musicTarget, /setInterval|SetTimer|CreateThreadpoolTimer/);
});

test('an already-playing target is handed back to the media observer and also confirms natively', () => {
  assert.match(reconcile, /playing: true, media: active/);
  assert.match(reconcile, /__homePanelSpotifyMediaObserverRuntime/);
  assert.match(reconcile, /runtime\.scheduleTargetChecks\(mediaState\.media\)/);
  assert.doesNotMatch(reconcile, /setInterval|SetTimer|CreateThreadpoolTimer/);
  assert.match(musicTarget, /json && std::wstring_view\(json\) == L"true"/);
});

test('YouTube and TVer reserve a compact card-style Spotify status strip', () => {
  assert.match(hostWindow, /kNativeSpotifyStatusHeight = 56/);
  assert.match(hostWindow, /GetSpotifyPlaybackStatuses\(\)/);
  assert.match(hostWindow, /heading\.append\(L"  確認 "\)/);
  assert.match(hostWindow, /statuses\.size\(\)/);
  assert.match(hostWindow, /kSpotifyStatusSurface = RGB\(20, 26, 36\)/);
  assert.match(hostWindow, /kSpotifyStatusOutline = RGB\(43, 54, 69\)/);
  assert.match(hostWindow, /RoundRect\(paintDc, card\.left/);
  assert.match(hostWindow, /CreateCompatibleDC\(dc\)/);
  assert.match(hostWindow, /BitBlt\(dc, 0, 0, width, height, paintDc/);
  assert.match(hostWindow, /RECT statusBounds = bounds/);
  assert.match(hostWindow, /RECT videoBounds = bounds/);
  assert.match(hostWindow, /videoBounds\.top =/);
  assert.match(hostWindow, /kNativeSpotifyStatusRefreshMs = 5U \* 1000U/);
});
