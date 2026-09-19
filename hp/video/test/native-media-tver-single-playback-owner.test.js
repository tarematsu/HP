import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const episode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const playbackPolicy = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');

test('TVer event policy reports playback loss but never owns playback recovery', () => {
  assert.doesNotMatch(episode, /video\.play\s*\(/);
  assert.doesNotMatch(episode, /playButton\.click\s*\(/);
  assert.match(episode, /startRecovery\(eventName\)/);
  assert.match(episode, /if \(!video\.ended\) startRecovery\('pause'\)/);
  assert.match(episode, /wakeNative\('recovery:' \+ reason/);
  assert.doesNotMatch(episode, /recovery:tick:|recoveryWakeTimer|armRecoveryWake/);
});

test('paused TVer playback recovery is idempotent and never toggles the video surface', () => {
  assert.match(playbackPolicy, /if \(video\.paused && !video\.ended\)/);
  assert.match(playbackPolicy, /const pending = video\.play\(\)/);
  assert.match(playbackPolicy, /pending\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(playbackPolicy, /point\(video\)/);
  assert.doesNotMatch(playbackPolicy, /video\.pause\s*\(/);
  assert.doesNotMatch(playbackPolicy, /__homePanelTverResumeBlocked/);
});

test('TVer fullscreen recovery remains bounded to the loaded player', () => {
  assert.match(playbackPolicy, /homepanel:tver-fullscreen-key/);
  assert.match(playbackPolicy, /const fullscreenControlPoint = media =>/);
  assert.match(playbackPolicy, /const root = playerRootFor\(media\)/);
  assert.match(playbackPolicy, /const fullscreenButton = controls\.find\(isEnterFullscreenControl\)/);
  assert.match(playbackPolicy, /__homePanelTverFullscreenRecovery/);
  assert.match(playbackPolicy, /fullscreenRecovery\.video !== video/);
  assert.match(playbackPolicy, /attempts < 4/);
  assert.doesNotMatch(episode, /fullscreenAttemptCount|fullscreenKeyRequestedAt/);
  assert.doesNotMatch(playbackPolicy, /const videoFullscreenPoint = media =>/);
  assert.doesNotMatch(playbackPolicy, /const fullscreenPoint = videoFullscreenPoint\(video\)/);
});

test('TVer routing keys live directly in the shared media base', () => {
  assert.match(mediaBase, /kNativeMediaTverLoopScript\[\]/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogScript\[\]/);
  assert.match(mediaBase, /homepanel-tver-loop-routing-key/);
  assert.match(mediaBase, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(mediaBase, /MutationObserver|querySelectorAll|video\.play/);
});
