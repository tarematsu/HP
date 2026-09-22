import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('TVer program playback settings are simple and event driven', () => {
  assert.match(runtime, /video\.defaultPlaybackRate = 1\.75/);
  assert.match(runtime, /video\.playbackRate !== 1\.75/);
  assert.match(runtime, /video\.volume !== 1\.0/);
  assert.match(runtime, /video\.muted/);
  assert.doesNotMatch(runtime, /setInterval\(/);
  assert.doesNotMatch(runtime, /addEventListener\('ratechange'/);
  assert.match(runtime, /state\.videoAbort = new AbortController/);
});

test('TVer quality discovery is event driven, bounded and player-local', () => {
  assert.doesNotMatch(runtime, /qualityProbeIntervalMs|qualityProbeLimit|qualityProbeAttempts|qualityProbeAt/);
  assert.match(runtime, /const controls = \(\) => Array\.from\(player\.querySelectorAll/);
  assert.match(runtime, /state\.qualityApplied/);
  assert.match(runtime, /Number\(state\.qualityAttempts \|\| 0\) < 4/);
  assert.match(runtime, /arm\(low, 'quality-low', 700\)/);
  assert.match(runtime, /arm\(menu, 'quality-menu', 700\)/);
  assert.match(runtime, /state\.playerObserver\.observe\(player/);
});

test('TVer ads do not receive program speed, volume or ordinary playback recovery mutation', () => {
  const adStart = runtime.indexOf('if (adActive) {');
  const programStart = runtime.indexOf('if (!fullscreen()) return requestFullscreen();', adStart);
  assert.ok(adStart >= 0 && programStart > adStart);
  const adBranch = runtime.slice(adStart, programStart);
  assert.match(adBranch, /arm\(skip, 'skip-ad', 600\)/);
  assert.doesNotMatch(adBranch, /video\.playbackRate = 1\.75/);
  assert.doesNotMatch(adBranch, /video\.volume = 1\.0/);
  assert.doesNotMatch(adBranch, /video\.play\(/);
});

test('TVer ad identity is reduced to media key plus explicit player facts', () => {
  assert.match(runtime, /const mediaKey = \(\) => \(video\.currentSrc \|\| video\.src \|\| ''\)\.trim\(\)/);
  assert.match(runtime, /const explicitAd = \(\) =>/);
  assert.match(runtime, /const shortMedia = length >= 5 && length <= 65/);
  assert.match(runtime, /key !== state\.programKey/);
  assert.doesNotMatch(runtime, /adIdentity|postrollAfterProgram/);
});
