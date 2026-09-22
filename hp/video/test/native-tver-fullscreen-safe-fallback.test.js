import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const fullscreen = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc', import.meta.url),
  'utf8',
);

test('TVer no longer treats CSS viewport fill as fullscreen', () => {
  assert.doesNotMatch(runtime, /__homePanelTverEnsureViewportFullscreen/);
  assert.doesNotMatch(runtime, /data-homepanel-tver-viewport-root/);
  assert.doesNotMatch(runtime, /position:fixed !important/);
  assert.match(runtime, /document\.fullscreenElement/);
});

test('TVer fullscreen never falls back to a blind video-corner click', () => {
  assert.match(runtime, /const fullscreenControl = \(\) =>/);
  assert.match(runtime, /arm\(fullscreenControl\(\), 'fullscreen', 1200\)/);
  assert.match(runtime, /document\.elementFromPoint\(point\.x, point\.y\)/);
  assert.doesNotMatch(runtime, /videoFullscreenPoint|fullscreenPoint =/);
});

test('TVer fullscreen uses YouTube-style key first and real control fallback', () => {
  const key = runtime.indexOf("post('homepanel:tver-fullscreen-key')");
  const control = runtime.indexOf("arm(fullscreenControl(), 'fullscreen', 1200)");
  assert.ok(key >= 0 && control > key);
  assert.match(runtime, /state\.fullscreenKeyRequestedAt/);
  assert.match(runtime, /wake\(1200\)/);
  assert.doesNotMatch(runtime, /__homePanelTverFullscreenRecovery|fullscreenAttemptCount/);
});

test('TVer post-click fullscreen helper only verifies state and wakes recovery', () => {
  assert.match(fullscreen, /document\.fullscreenElement/);
  assert.match(fullscreen, /state\.fullscreenKeyRequestedAt = 0/);
  assert.match(fullscreen, /homepanel:tver-wake/);
  assert.doesNotMatch(fullscreen, /requestFullscreen|webkitRequestFullscreen|request\.call/);
});

test('natural TVer completion has no wall-clock safety cap', () => {
  assert.doesNotMatch(
    runtime,
    /episodeMaxPlaybackMs|episodeStartedAt|episodeLimitTimer|armEpisodeLimit|enforceEpisodeLimit/,
  );
  assert.match(runtime, /event\.type === 'ended'/);
  assert.match(runtime, /key === state\.programKey/);
  assert.match(runtime, /state\.programEndPending = true/);
  assert.match(runtime, /post\('homepanel:tver-ended'\)/);
});
