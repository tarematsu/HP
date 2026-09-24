import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const watchdog = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8');
const nativeQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');

test('TVer uses one episode-scoped runtime while queue state stays native-owned', () => {
  assert.match(runtime, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.match(runtime, /window\.__homePanelTverRuntime/);
  assert.match(watchdog, /kNativeMediaTverControlRecoveryScript/);
  assert.doesNotMatch(runtime, /__homePanelTverEpisodeQueue|sessionStorage/);
  assert.match(nativeQueue, /struct NativeMediaTverNativeQueueState/);
  assert.match(nativeQueue, /std::vector<std::wstring> queueEpisodeIds/);
  assert.match(nativeQueue, /std::vector<std::wstring> consumedEpisodeIds/);
});

test('TVer ad skip is chosen before ordinary program recovery', () => {
  const adIndex = runtime.indexOf('if (adActive) {');
  const skipIndex = runtime.indexOf("arm(skip, 'skip-ad', 600)", adIndex);
  const normalFullscreen = runtime.indexOf('if (!fullscreen()) return requestFullscreen();', skipIndex);
  const paused = runtime.indexOf('if (video.paused && !video.ended)', normalFullscreen);
  assert.ok(adIndex >= 0 && skipIndex > adIndex);
  assert.ok(normalFullscreen > skipIndex && paused > normalFullscreen);
  const adBranch = runtime.slice(adIndex, normalFullscreen);
  assert.doesNotMatch(adBranch, /video\.play\(/);
  assert.doesNotMatch(adBranch, /video\.volume = 1\.0/);
  assert.doesNotMatch(adBranch, /video\.playbackRate = 1\.75/);
});

test('TVer fullscreen uses a repeated trusted bottom-right video tap', () => {
  assert.match(runtime, /const requestFullscreen = \(\) =>/);
  assert.match(runtime, /video\.getBoundingClientRect/);
  assert.match(runtime, /rect\.right - 12/);
  assert.match(runtime, /rect\.bottom - 12/);
  assert.match(runtime, /state\.fullscreenCornerTapAt/);
  assert.match(runtime, /document\.fullscreenElement/);
  assert.doesNotMatch(runtime, /homepanel:tver-fullscreen-key|fullscreenControl/);
  assert.doesNotMatch(runtime, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
});

test('TVer low quality keeps retrying trusted clicks until confirmed', () => {
  assert.match(runtime, /state\.qualityApplied/);
  assert.match(runtime, /qualityLastAttemptAt/);
  assert.doesNotMatch(runtime, /qualityAttempts >= 4\) state\.qualityApplied = true/);
  assert.match(runtime, /arm\(low, 'quality-low', 700\)/);
  assert.match(runtime, /arm\(menu, 'quality-menu', 700\)/);
  assert.doesNotMatch(runtime, /\.click\(\)/);
  assert.doesNotMatch(runtime, /setInterval\(/);
});

test('paused TVer program recovery is idempotent and uses the same trusted control path', () => {
  assert.match(runtime, /if \(video\.paused && !video\.ended\)/);
  assert.match(runtime, /video\.play\(\)\?\.catch\?\.\(\(\) => \{\}\)/);
  assert.match(runtime, /arm\(play, 'play', 1200\)/);
  assert.doesNotMatch(runtime, /video\.pause\(/);
  assert.doesNotMatch(runtime, /point\(video\)/);
});

test('TVer natural completion requires the active program media near its real end', () => {
  assert.match(runtime, /event\.type === 'ended'/);
  assert.match(runtime, /key === state\.programKey/);
  assert.match(runtime, /at >= Math\.max\(3, length - 10\)/);
  assert.match(runtime, /state\.programEndPending = true/);
  assert.match(runtime, /state\.endReported = true/);
  assert.match(runtime, /post\('homepanel:tver-ended'\)/);
  assert.doesNotMatch(runtime, /episodeMaxPlaybackMs|postrollGraceMs/);
});

test('TVer program speed and volume are applied only after the ad branch', () => {
  const adIndex = runtime.indexOf('if (adActive) {');
  const rateIndex = runtime.indexOf('video.defaultPlaybackRate = 1.75');
  const volumeIndex = runtime.indexOf('video.volume = 1.0');
  assert.ok(adIndex >= 0 && rateIndex > adIndex && volumeIndex > adIndex);
  assert.match(runtime, /if \(video\.muted\) video\.muted = false/);
});

test('TVer observation is player-scoped and event-driven', () => {
  assert.match(runtime, /state\.playerObserver = new MutationObserver\(\(\) => wake\(0\)\)/);
  assert.match(runtime, /state\.playerObserver\.observe\(player/);
  assert.match(runtime, /state\.videoAbort = new AbortController/);
  assert.match(runtime, /document\.addEventListener\('fullscreenchange'/);
  assert.doesNotMatch(runtime, /setInterval\(/);
});
