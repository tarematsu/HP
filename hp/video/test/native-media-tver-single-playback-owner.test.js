import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');

test('one TVer runtime owns event reporting and idempotent playback recovery', () => {
  assert.match(runtime, /window\.__homePanelTverRuntime/);
  assert.match(runtime, /'playing','pause','waiting','stalled','ended','error'/);
  assert.match(runtime, /if \(video\.paused && !video\.ended\)/);
  assert.match(runtime, /video\.play\(\)\?\.catch/);
  assert.match(runtime, /arm\(play, 'play', 1200\)/);
  assert.match(runtime, /post\('homepanel:tver-wake'\)/);
  assert.doesNotMatch(runtime, /recoveryPending|recoveryWakeTimer|armRecoveryWake/);
});

test('paused TVer playback recovery never toggles the video surface', () => {
  assert.match(runtime, /if \(video\.paused && !video\.ended\)/);
  assert.match(runtime, /video\.play\(\)\?\.catch/);
  assert.match(runtime, /arm\(play, 'play', 1200\)/);
  assert.doesNotMatch(runtime, /point\(video\)/);
  assert.doesNotMatch(runtime, /video\.pause\s*\(/);
  assert.doesNotMatch(runtime, /__homePanelTverResumeBlocked/);
});

test('TVer fullscreen recovery targets the bottom-right video coordinate directly', () => {
  assert.match(runtime, /const requestFullscreen = \(\) =>/);
  assert.match(runtime, /video\.getBoundingClientRect/);
  assert.match(runtime, /rect\.right - 12/);
  assert.match(runtime, /rect\.bottom - 12/);
  assert.match(runtime, /state\.fullscreenCornerTapAt/);
  assert.match(runtime, /return \[x, y\]/);
  assert.doesNotMatch(runtime, /homepanel:tver-fullscreen-key|fullscreenControl/);
  assert.doesNotMatch(runtime, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
});

test('TVer routing keys live directly in the shared media base', () => {
  assert.doesNotMatch(mediaBase, /kNativeMediaTverLoopScript\[\]/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogScript\[\]/);
  assert.doesNotMatch(mediaBase, /homepanel-tver-loop-routing-key/);
  assert.match(mediaBase, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(mediaBase, /MutationObserver|querySelectorAll|video\.play/);
});
