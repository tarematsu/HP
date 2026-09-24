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

test('TVer has no viewport-fill pseudo fullscreen', () => {
  assert.doesNotMatch(runtime, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
  assert.doesNotMatch(runtime, /position:fixed !important; inset:0 !important/);
  assert.match(runtime, /if \(!fullscreen\(\)\) return requestFullscreen\(\)/);
  assert.match(runtime, /document\.fullscreenElement/);
});

test('TVer fullscreen deliberately taps the video bottom-right corner', () => {
  assert.match(runtime, /const requestFullscreen = \(\) =>/);
  assert.match(runtime, /video\.getBoundingClientRect/);
  assert.match(runtime, /rect\.right - 12/);
  assert.match(runtime, /rect\.bottom - 12/);
  assert.match(runtime, /return \[x, y\]/);
  assert.doesNotMatch(runtime, /fullscreenControl|homepanel:tver-fullscreen-key/);
});

test('TVer corner tap retries until real browser fullscreen is observed', () => {
  assert.match(runtime, /state\.fullscreenCornerTapAt/);
  assert.match(runtime, /now - state\.fullscreenCornerTapAt < 1400/);
  assert.match(runtime, /wake\(1500\)/);
  assert.match(runtime, /document\.fullscreenElement/);
  assert.doesNotMatch(runtime, /fullscreenKeyRequestedAt|fullscreenAttemptCount/);
});

test('TVer post-click fullscreen helper only verifies state and wakes recovery', () => {
  assert.match(fullscreen, /document\.fullscreenElement/);
  assert.match(fullscreen, /state\.fullscreenCornerTapAt = 0/);
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
