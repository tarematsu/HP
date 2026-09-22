import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const watchdog = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8');

test('episode pages route to one unified TVer control-recovery policy', () => {
  assert.match(wrapper, /#include "media_tver_episode_loop_policy\.inc"/);
  assert.match(wrapper, /kNativeMediaTverEpisodeLoopPolicyScript/);
  assert.match(watchdog, /kNativeMediaTverControlRecoveryScript/);
  assert.doesNotMatch(wrapper, /media_tver_series_dom_policy/);
});

test('TVer ad detection stays inside the player subtree', () => {
  assert.match(runtime, /const player = video\.closest/);
  assert.match(runtime, /player\.querySelectorAll\(selectors\.join\(','\)\)/);
  assert.doesNotMatch(runtime, /document\.querySelectorAll\(selectors\.join\(','\)\)/);
});

test('TVer uses one scoped observer and media event bindings', () => {
  assert.match(runtime, /state\.playerObserver = new MutationObserver\(\(\) => wake\(0\)\)/);
  assert.match(runtime, /state\.playerObserver\.observe\(player/);
  assert.match(runtime, /state\.videoAbort = new AbortController/);
  assert.doesNotMatch(runtime, /observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(runtime, /setInterval\(/);
});

test('TVer ad classification uses explicit player markers plus bounded short-media fallback', () => {
  assert.match(runtime, /const explicitAd = \(\) =>/);
  assert.match(runtime, /shortMedia = length >= 5 && length <= 65/);
  assert.match(runtime, /explicitAd\(\) \|\|/);
  assert.match(runtime, /video\.playbackRate <= 1\.05/);
});

test('TVer playback rate is applied directly without a ratechange observer', () => {
  assert.match(runtime, /video\.defaultPlaybackRate = 1\.75/);
  assert.match(runtime, /video\.playbackRate = 1\.75/);
  assert.doesNotMatch(runtime, /addEventListener\('ratechange'/);
});

test('TVer quality discovery is bounded and event-driven', () => {
  assert.match(runtime, /state\.qualityAttempts/);
  assert.match(runtime, /Number\(state\.qualityAttempts \|\| 0\) < 4/);
  assert.match(runtime, /arm\(low, 'quality-low', 700\)/);
  assert.match(runtime, /arm\(menu, 'quality-menu', 700\)/);
  assert.doesNotMatch(runtime, /qualityProbeIntervalMs|qualityProbeLimit|setInterval\(/);
});

test('TVer fullscreen uses the same key-then-button sequence as YouTube', () => {
  const key = runtime.indexOf("post('homepanel:tver-fullscreen-key')");
  const control = runtime.indexOf("arm(fullscreenControl(), 'fullscreen', 1200)");
  assert.ok(key >= 0 && control > key);
  assert.match(runtime, /document\.fullscreenElement/);
  assert.match(runtime, /document\.elementFromPoint/);
  assert.doesNotMatch(runtime, /fullscreenAttemptCount|__homePanelTverFullscreenRecovery/);
});

test('healthy TVer runtime does not enumerate page-wide controls', () => {
  assert.match(runtime, /const controls = \(\) => Array\.from\(player\.querySelectorAll/);
  assert.doesNotMatch(
    runtime,
    /Array\.from\(document\.querySelectorAll\(\s*'button/,
  );
});
