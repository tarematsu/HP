import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const youtubeRecovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const tverPlayback = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);

test('YouTube recovery owns its event wake and bounded recheck timers', () => {
  assert.match(youtubeRecovery, /const wake = \(delay = 80\) =>/);
  assert.match(youtubeRecovery, /const recheck = \(delay = 2000\) =>/);
  assert.match(youtubeRecovery, /postMessage\('homepanel:youtube-wake'\)/);
  assert.match(youtubeRecovery, /\['playing', 'pause', 'waiting', 'stalled', 'ended', 'error'\]/);
  assert.doesNotMatch(youtubeRecovery, /setInterval\s*\(/);
});

test('TVer stalled or paused playback wakes native every two seconds only until progress resumes', () => {
  assert.match(tverEpisode, /\['waiting', 'stalled'\]/);
  assert.match(tverEpisode, /recoveryPending/);
  assert.match(tverEpisode, /recoverySince/);
  assert.match(tverEpisode, /recoveryWakeTimer/);
  assert.match(tverEpisode, /recovery:tick:/);
  assert.match(tverEpisode, /}, 2000\);/);
  assert.match(tverEpisode, /clearRecoveryWake/);
  assert.match(tverEpisode, /requestRecoveryWake/);
  assert.match(tverEpisode, /requestRecoveryWake\?\.\('initial-pause'\)/);
});

test('TVer recovery bypasses the healthy fast path and escalates after 30 seconds', () => {
  assert.match(tverPlayback, /!state\.recoveryPending/);
  assert.match(tverPlayback, /state && state\.recoveryPending/);
  assert.match(tverPlayback, /recoveryAge >= 30 \* 1000/);
  assert.match(tverPlayback, /return 'restart'/);
  assert.match(tverPlayback, /requestRecoveryWake\?\.\('pending-watchdog'\)/);
  assert.match(tverPlayback, /requestRecoveryWake\?\.\('paused-watchdog'\)/);
});