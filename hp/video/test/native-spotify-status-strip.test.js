import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
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

test('only yuukiar Spotify slot is active for single-window diagnostics', () => {
  assert.match(header, /kSpotifyProfileFirstAccountNumber = 2/);
  assert.match(header, /kSpotifyActiveAccountCount = 1/);
  assert.match(header, /kAccountCount = kSpotifyActiveAccountCount/);
  assert.match(scripts, /L"yuukiar"/);
  assert.doesNotMatch(scripts, /L"ten"|L"nagi"|L"hinata"|L"amazon"|L"ozeki"/);
});

test('status title and confirmation clock come from the page playback observer', () => {
  assert.match(header, /std::wstring observedTrackTitle/);
  assert.match(header, /SYSTEMTIME playbackConfirmedAt/);
  assert.doesNotMatch(controller, /add_DocumentTitleChanged/);
  assert.doesNotMatch(controller, /get_DocumentTitle/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(runtime, /postFields\('spotify:timed-resumed', String\(remainingMs\)\)/);
  assert.match(musicTarget, /ArmTimedEndObserver\(\*target\)/);
  assert.match(rotation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(rotation, /target->playbackConfirmed = true/);
  assert.match(rotation, /slot\.observedTrackTitle\.clear\(\)/);
  assert.match(rotation, /slot\.playbackConfirmed = false/);
  assert.match(scripts, /result\[i\]\.trackTitle = slots_\[i\]\.observedTrackTitle/);
  assert.doesNotMatch(musicTarget, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(lifecycle, /GetSpotifyPlaybackStatuses\(\) noexcept/);
});

test('target plus pause control confirms playback before arming status observer', () => {
  assert.match(reconcile, /currentMatchesTarget/);
  assert.match(reconcile, /controlIntent === 'pause'/);
  assert.match(reconcile, /buttonIntentValue === 'pause'/);
  assert.match(reconcile, /return true/);
  assert.doesNotMatch(reconcile, /runtime\.scheduleTargetChecks/);
  assert.doesNotMatch(reconcile, /setInterval|SetTimer|CreateThreadpoolTimer/);
  assert.match(musicTarget, /json && std::wstring_view\(json\) == L"true"/);
  assert.match(musicTarget, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(musicTarget, /SetMusicCompletionDeadline\(\*target, callbackNow, 0, false\)/);
  assert.match(musicTarget, /ArmTimedEndObserver\(\*target\)/);
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
