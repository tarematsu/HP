import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const playbackPolicy = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
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
  assert.match(playbackPolicy, /if \(video\.paused && !video\.ended\)/);
  assert.match(playbackPolicy, /video\.play\(\)\?\.catch/);
  assert.match(playbackPolicy, /arm\(play, 'play', 1200\)/);
  assert.doesNotMatch(playbackPolicy, /point\(video\)/);
  assert.doesNotMatch(playbackPolicy, /video\.pause\s*\(/);
  assert.doesNotMatch(playbackPolicy, /__homePanelTverResumeBlocked/);
});

test('TVer fullscreen recovery is key-first and then targets a labelled real control', () => {
  const key = playbackPolicy.indexOf("post('homepanel:tver-fullscreen-key')");
  const control = playbackPolicy.indexOf("arm(fullscreenControl(), 'fullscreen', 1200)");
  assert.ok(key >= 0 && control > key);
  assert.match(playbackPolicy, /const fullscreenControl = \(\) =>/);
  assert.match(playbackPolicy, /全画面\|フルスクリーン\|fullscreen\|full screen/);
  assert.match(playbackPolicy, /document\.elementFromPoint/);
  assert.doesNotMatch(playbackPolicy, /__homePanelTverFullscreenRecovery|fullscreenAttemptCount/);
});

test('TVer routing keys live directly in the shared media base', () => {
  assert.match(mediaBase, /kNativeMediaTverLoopScript\[\]/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogScript\[\]/);
  assert.match(mediaBase, /homepanel-tver-loop-routing-key/);
  assert.match(mediaBase, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(mediaBase, /MutationObserver|querySelectorAll|video\.play/);
});
