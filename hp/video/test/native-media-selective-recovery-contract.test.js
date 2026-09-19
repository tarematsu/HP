import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const youtubeRecovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const tverPlayback = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);

test('YouTube recovery uses one wake timer for events and rechecks', () => {
  assert.match(youtubeRecovery, /const wake = \(delay = 80\) =>/);
  assert.match(youtubeRecovery, /const recheck = \(\) => wake\(2000\)/);
  assert.match(youtubeRecovery, /postMessage\('homepanel:youtube-wake'\)/);
  assert.match(youtubeRecovery, /\['playing', 'pause', 'waiting', 'stalled', 'ended', 'error'\]/);
  assert.doesNotMatch(youtubeRecovery, /recheckTimer|setInterval\s*\(/);
});

test('TVer stalled or paused playback sends one native recovery wake', () => {
  assert.match(tverEpisode, /\['waiting', 'stalled'\]/);
  assert.match(tverEpisode, /recoveryPending/);
  assert.match(tverEpisode, /recoverySince/);
  assert.match(tverEpisode, /state\.recoveryPending\) return/);
  assert.match(tverEpisode, /wakeNative\('recovery:' \+ reason \+ ':' \+ mediaIdentity\(video\), true\)/);
  assert.match(tverEpisode, /clearRecoveryState/);
  assert.match(tverEpisode, /requestRecoveryWake/);
  assert.match(tverEpisode, /requestRecoveryWake\?\.\('initial-pause'\)/);
  assert.doesNotMatch(tverEpisode, /recoveryWakeTimer|recovery:tick:|armRecoveryWake/);
});

test('TVer native watchdog owns recovery cadence and escalates after 30 seconds', () => {
  assert.match(tverPlayback, /!state\.recoveryPending/);
  assert.match(tverPlayback, /state && state\.recoveryPending/);
  assert.match(tverPlayback, /recoveryAge >= 30 \* 1000/);
  assert.match(tverPlayback, /return 'restart'/);
  assert.match(tverPlayback, /requestRecoveryWake\?\.\('pending-watchdog'\)/);
  assert.match(tverPlayback, /requestRecoveryWake\?\.\('paused-watchdog'\)/);
  assert.doesNotMatch(tverPlayback, /setInterval\s*\(/);
});
