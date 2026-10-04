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
  assert.match(wrapper, /kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(watchdog, /kNativeMediaTverControlRecoveryScript/);
  assert.doesNotMatch(wrapper, /media_tver_series_dom_policy/);
});

test('TVer legacy ad detection stays inside the player subtree', () => {
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
  assert.match(runtime, /return explicitAd\(\) \|\| shortMedia/);
});

test('TVer playback rate is restored and synchronized with the current UI', () => {
  assert.match(runtime, /video\.defaultPlaybackRate = 1\.75/);
  assert.match(runtime, /video\.playbackRate = 1\.75/);
  assert.match(runtime, /currentSettingsSpeedConfirmed/);
  assert.match(runtime, /speed175Option/);
  assert.match(runtime, /speed-menu/);
  assert.match(runtime, /'ratechange'/);
});

test('TVer quality discovery retries and recognizes the redesigned current-value control', () => {
  assert.match(runtime, /qualityLastAttemptAt/);
  assert.doesNotMatch(runtime, /qualityAttempts >= 4\) state\.qualityApplied = true/);
  assert.match(runtime, /qualityIndicator/);
  assert.match(runtime, /quality-low-v2/);
  assert.match(runtime, /quality-menu-v2/);
  assert.match(runtime, /currentSettingsQualityConfirmed/);
  assert.doesNotMatch(runtime, /qualityProbeIntervalMs|qualityProbeLimit|setInterval\(/);
});

test('TVer fullscreen is requested through the native trusted user-gesture bridge', () => {
  assert.match(runtime, /document\.fullscreenElement/);
  assert.match(runtime, /currentSettingsFullscreenRequestAt/);
  assert.match(runtime, /homepanel:tver-fullscreen-key/);
  assert.match(runtime, /Runtime\.evaluate\(userGesture=true\)/);
  assert.match(runtime, /state\.fullscreenCornerTapAt = now/);
  assert.doesNotMatch(runtime, /fullscreenAttemptCount|__homePanelTverFullscreenRecovery/);
  assert.doesNotMatch(runtime, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
});

test('current TVer settings discovery stays bounded to semantic controls without polling', () => {
  assert.match(runtime, /const controlSelector = \[/);
  assert.match(runtime, /\[role="menuitemradio"\]/);
  assert.match(runtime, /document\.querySelectorAll\(controlSelector\)/);
  assert.doesNotMatch(runtime, /setInterval\(/);
});