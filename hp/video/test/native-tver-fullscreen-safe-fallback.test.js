import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const watchdog = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const fullscreen = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc', import.meta.url),
  'utf8',
);
const episode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('TVer fullscreen never falls back to a blind video-corner click', () => {
  assert.match(watchdog, /const fullscreenControlPoint = media =>/);
  assert.match(watchdog, /const fullscreenButton = controls\.find\(isEnterFullscreenControl\)/);
  assert.doesNotMatch(watchdog, /const videoFullscreenPoint = media =>/);
  assert.doesNotMatch(watchdog, /const fullscreenPoint = videoFullscreenPoint\(video\)/);
});

test('TVer watchdog owns bounded fullscreen retries', () => {
  assert.match(watchdog, /__homePanelTverFullscreenRecovery/);
  assert.match(watchdog, /fullscreenRecovery\.attempts/);
  assert.match(watchdog, /attempts < 4/);
  assert.match(watchdog, /Date\.now\(\) - requestedAt >= 1000/);
  assert.doesNotMatch(episode, /fullscreenAttemptCount|fullscreenKeyRequestedAt/);
});

test('TVer fullscreen verification can directly request browser fullscreen', () => {
  assert.match(fullscreen, /requestFullscreen|webkitRequestFullscreen|msRequestFullscreen/);
  assert.match(fullscreen, /request\.call\(target\)/);
  assert.match(fullscreen, /homepanel:tver-wake/);
  assert.match(fullscreen, /__homePanelTverFullscreenRecovery/);
});

test('natural TVer completion remains allowed before the 15-minute safety cap', () => {
  assert.match(episode, /if \(state\.programPlaybackConfirmed && video\.ended/);
  assert.match(episode, /const completedItem = state\.programPlaybackConfirmed &&/);
  assert.match(episode, /if \(stableEnd && completedItem\)/);
  assert.doesNotMatch(episode, /video\.loop = holdUntilDeadline/);
});
