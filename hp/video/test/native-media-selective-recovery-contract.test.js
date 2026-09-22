import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const youtubeRecovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const tver = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('YouTube recovery uses one wake timer for events and rechecks', () => {
  assert.match(youtubeRecovery, /const wake = \(delay = 80\) =>/);
  assert.match(youtubeRecovery, /const recheck = \(\) => wake\(2000\)/);
  assert.match(youtubeRecovery, /postMessage\('homepanel:youtube-wake'\)/);
  assert.match(youtubeRecovery, /\['playing', 'pause', 'waiting', 'stalled', 'ended', 'error'\]/);
  assert.doesNotMatch(youtubeRecovery, /recheckTimer|setInterval\s*\(/);
});

test('TVer uses the same single wake timer for stalled, waiting and paused recovery', () => {
  assert.match(tver, /const wake = \(delay = 80\) =>/);
  assert.match(tver, /const recheck = \(\) => wake\(2000\)/);
  assert.match(tver, /'playing','pause','waiting','stalled','ended','error'/);
  assert.match(tver, /wake\(event\.type === 'waiting' \|\| event\.type === 'stalled' \? 0 : 80\)/);
  assert.match(tver, /if \(video\.paused && !video\.ended\)/);
  assert.match(tver, /recheck\(\)/);
  assert.doesNotMatch(tver, /recoveryPending|recoveryWakeTimer|armRecoveryWake|setInterval\s*\(/);
});

test('TVer recovery is one action per pass and escalates only hard media errors to restart', () => {
  assert.match(tver, /if \(video\.error\) return 'restart'/);
  assert.match(tver, /video\.play\(\)\?\.catch/);
  assert.match(tver, /arm\(play, 'play', 1200\)/);
  assert.match(tver, /return 'recovery'/);
  assert.doesNotMatch(tver, /recoveryAge|pending-watchdog|paused-watchdog/);
});
