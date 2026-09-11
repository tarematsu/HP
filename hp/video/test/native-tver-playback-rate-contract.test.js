import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const episode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8');
const watchdog = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8');

test('TVer program playback settings are dirty-state and event driven', () => {
  assert.match(episode, /const playbackRate = 1\.75/);
  assert.match(episode, /const targetVolume = 1\.0/);
  assert.doesNotMatch(episode, /setInterval\(ensure/);
  assert.match(episode, /playbackSettingsApplied/);
  assert.match(episode, /if \(!state\.playbackSettingsApplied\)/);
  assert.match(episode, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(episode, /video\.playbackRate = playbackRate/);
  assert.match(episode, /addEventListener\('ratechange'/);
  assert.match(episode, /addEventListener\('volumechange'/);
});

test('TVer quality discovery is rate limited and bounded', () => {
  assert.match(episode, /qualityProbeIntervalMs = 5000/);
  assert.match(episode, /qualityProbeLimit = 4/);
  assert.match(episode, /state\.qualityProbeAttempts < qualityProbeLimit/);
  assert.match(episode, /now - state\.qualityProbeAt >= qualityProbeIntervalMs/);
  assert.match(episode, /const root = playerRootFor\(video\)/);
});

test('TVer ads do not receive program speed, volume or recovery mutation', () => {
  const adStart = episode.indexOf('if (advertisementActive) {');
  const adEnd = episode.indexOf('if (state.adActive) {', adStart);
  assert.ok(adStart >= 0 && adEnd > adStart);
  const adBranch = episode.slice(adStart, adEnd);
  assert.match(adBranch, /window\.__homePanelTverAdActive = true/);
  assert.match(adBranch, /wakeNative\(\)/);
  assert.doesNotMatch(adBranch, /video\.playbackRate/);
  assert.doesNotMatch(adBranch, /video\.volume/);
  assert.doesNotMatch(adBranch, /video\.play\(/);
  assert.match(watchdog, /During ads the watchdog may only click Skip or the fullscreen control/);
});

test('TVer ad identity is tracked across a complete ad pod', () => {
  assert.match(episode, /const mediaIdentity = video =>/);
  assert.match(episode, /video\.currentSrc \|\| video\.src/);
  assert.match(episode, /state\.adIdentity && identity && state\.adIdentity !== identity/);
  assert.match(episode, /state\.adIdentity = identity/);
  assert.match(episode, /state\.adIdentity = ''/);
});
