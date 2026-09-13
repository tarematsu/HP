import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  new URL('../../cloud/src/spotify_random_catalog.ts', import.meta.url), 'utf8');
const deviceSync = readFileSync(
  new URL('../../cloud/src/device_sync.ts', import.meta.url), 'utf8');
const durationResolver = readFileSync(
  new URL('../../cloud/src/spotify_track_durations.ts', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');

test('cloud persists trackId and durationMs for every managed Spotify music target', () => {
  assert.match(catalog, /trackId/);
  assert.match(catalog, /6Vy6hCA2CZwZalGqaX6Sew/);
  assert.doesNotMatch(catalog, /235267/);
  assert.match(durationResolver, /\/v1\/tracks\/\$\{spotifyId\}/);
  assert.match(durationResolver, /duration_ms/);
  assert.match(deviceSync, /spotifyRotationStoredDurations/);
  assert.match(deviceSync, /missingDurationIds/);
  assert.match(deviceSync, /resolveSpotifyTrackDurations/);
  assert.match(deviceSync, /applySpotifyRotationDurations/);
  assert.match(deviceSync, /track\.durationMs = durationMs/);
  assert.match(header, /ULONGLONG durationMs = 0/);
  assert.match(cloud, /GetNamedNumber\(L"durationMs", 0\.0\)/);
  assert.match(cloud, /track\.durationMs = static_cast<ULONGLONG>/);
});

test('music completion deadline is armed by NavigationCompleted without a start event', () => {
  const completedStart = controller.indexOf('slot.webview->add_NavigationCompleted(');
  const completedEnd = controller.indexOf('\n    RECT client{};', completedStart);
  assert.ok(completedStart >= 0 && completedEnd > completedStart);
  const completed = controller.slice(completedStart, completedEnd);

  assert.match(completed, /SlotMatchesMusicTarget\(\*target\)/);
  assert.match(completed, /\.durationMs/);
  assert.match(completed, /timedCompletionDeadlineTick =/);
  assert.match(completed, /now \+ durationMs \+ kSpotifyNavigationCompletionGraceMs/);
  assert.match(completed, /timedCompletionDeadlineGeneration =\s*target->targetGeneration/);
  assert.match(completed, /ArmCompletionDeadlineTimer\(\)/);
  assert.doesNotMatch(completed, /ParseSpotifyStartedEvent/);
  assert.doesNotMatch(completed, /spotify:timed-started/);
});

test('late Spotify start notification cannot replace the navigation-owned deadline', () => {
  const handlerStart = rotation.indexOf('const bool started = ParseSpotifyStartedEvent');
  const handlerEnd = rotation.indexOf('\n            }).Get(),', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = rotation.slice(handlerStart, handlerEnd);

  assert.match(handler, /timedCompletionDeadlineTick == 0/);
  assert.match(handler, /timedCompletionDeadlineGeneration != eventGeneration/);
  assert.doesNotMatch(handler, /timedCompletionDeadlineTick = 0/);
});
