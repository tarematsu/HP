import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const youtubeRecovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const youtubeAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');
const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const tverPlayback = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);

test('YouTube recovery reuses one event-agent timer with a startup fallback', () => {
  assert.match(youtubeAgent, /state\.scheduleRecoveryWake = delay =>/);
  assert.match(youtubeRecovery, /agent\.scheduleRecoveryWake\(2000\)/);
  assert.match(youtubeRecovery, /__homePanelYoutubeStartupRecoveryTimer/);
  assert.match(youtubeRecovery, /setTimeout\(\(\) =>/);
  assert.match(youtubeRecovery, /postMessage\('homepanel:youtube-wake'\)/);
  assert.doesNotMatch(youtubeRecovery, /setInterval\s*\(/);
  assert.ok((youtubeRecovery.match(/recheck\(\)/g) || []).length >= 5);
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