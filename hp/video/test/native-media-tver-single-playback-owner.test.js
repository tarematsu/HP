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

test('TVer event policy never owns program playback recovery', () => {
  assert.doesNotMatch(episode, /video\.play\s*\(/);
  assert.doesNotMatch(episode, /playButton\.click\s*\(/);
  assert.match(episode, /if \(video\.paused && !video\.ended\) recoveryFlags\.push\('paused'\)/);
  assert.match(episode, /wakeNative\('recovery:' \+ recoveryFlags\.join\('\+'\)/);
});

test('paused TVer playback recovery is idempotent and never toggles the video surface', () => {
  assert.match(playbackPolicy, /if \(video\.paused && !video\.ended\)/);
  assert.match(playbackPolicy, /const pending = video\.play\(\)/);
  assert.match(playbackPolicy, /pending\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(playbackPolicy, /point\(video\)/);
  assert.doesNotMatch(playbackPolicy, /video\.pause\s*\(/);
  assert.doesNotMatch(playbackPolicy, /__homePanelTverResumeBlocked/);
});

test('TVer fullscreen recovery only targets the loaded video bottom-right', () => {
  assert.match(playbackPolicy, /const videoFullscreenPoint = media =>/);
  assert.match(playbackPolicy, /media\.readyState < HTMLMediaElement\.HAVE_METADATA/);
  assert.match(playbackPolicy, /const fullscreenPoint = videoFullscreenPoint\(video\)/);
  assert.match(playbackPolicy, /if \(fullscreenPoint\) return fullscreenPoint/);
  assert.doesNotMatch(playbackPolicy, /isEnterFullscreenControl|fullscreenButton/);
});

test('TVer routing keys live directly in the shared media base', () => {
  assert.match(mediaBase, /kNativeMediaTverLoopScript\[\]/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogScript\[\]/);
  assert.match(mediaBase, /homepanel-tver-loop-routing-key/);
  assert.match(mediaBase, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(mediaBase, /MutationObserver|querySelectorAll|video\.play/);
});
