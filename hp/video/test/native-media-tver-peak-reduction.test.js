import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const loop = [
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part1.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2a.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_observer.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_events.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part3a.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part3b.inc', import.meta.url), 'utf8'),
].join('\n');
const watchdog = [
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_guard.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_main1.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_main2.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc', import.meta.url), 'utf8'),
].join('\n');

test('episode pages route to one bounded TVer event policy', () => {
  assert.match(wrapper, /#include "media_tver_episode_loop_policy\.inc"/);
  assert.match(wrapper, /kNativeMediaTverEpisodeLoopPolicyScript/);
  assert.doesNotMatch(wrapper, /media_tver_series_dom_policy/);
});

test('TVer episode ad detection is bounded to the player subtree', () => {
  assert.match(loop, /const playerRootFor = video =>/);
  assert.match(loop, /depth < 5/);
  assert.match(loop, /root\.querySelectorAll\(selectors\.join\(','\)\)/);
  assert.doesNotMatch(loop, /document\.querySelectorAll\(selectors\.join\(','\)\)/);
});

test('TVer player observer filters relevant added nodes only', () => {
  assert.match(loop, /const interestingPlayerSelector = \[/);
  assert.match(loop, /for \(const node of mutation\.addedNodes\)/);
  assert.match(loop, /element\.matches\?\.\(interestingPlayerSelector\)/);
  assert.match(loop, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(loop, /observe\(document\.(?:documentElement|body)/);
});

test('known TVer ads use media facts before fallback DOM marker scan', () => {
  const activeIndex = loop.indexOf('if (state.adActive)');
  const markerIndex = loop.indexOf('return explicitAdMarker(video)', activeIndex);
  assert.ok(activeIndex >= 0 && markerIndex > activeIndex);
  assert.match(loop, /if \(shortAdLength && !video\.ended\) return true/);
});

test('TVer playback rate is initialized once per current video', () => {
  assert.match(loop, /if \(!state\.playbackSettingsApplied\)/);
  assert.match(loop, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(loop, /video\.playbackRate = playbackRate/);
  assert.doesNotMatch(loop, /addEventListener\('ratechange'/);
});

test('TVer quality discovery is event driven and player-local', () => {
  assert.doesNotMatch(loop, /qualityProbeIntervalMs|qualityProbeLimit|qualityProbeAttempts|qualityProbeAt/);
  assert.match(loop, /!state\.lowQualitySet && !state\.qualityAttemptExhausted/);
  assert.match(loop, /const root = playerRootFor\(video\)/);
  assert.match(loop, /for \(const element of root\.querySelectorAll\(/);
  assert.match(loop, /state\.lowQualitySet = true/);
  assert.match(loop, /scheduleEnsure\(40\)/);
});

test('TVer fullscreen uses one watchdog-owned bounded fallback sequence', () => {
  const control = watchdog.indexOf('const controlPoint = fullscreenControlPoint(video)');
  const key = watchdog.indexOf("homepanel:tver-fullscreen-key");
  assert.ok(control >= 0 && key > control);
  assert.match(watchdog, /if \(state\) state\.fullscreenDirty = true/);
  assert.match(watchdog, /state\.fullscreenDirty = false/);
  assert.match(watchdog, /homepanel:tver-wake/);
  assert.match(watchdog, /const isEnterFullscreenControl = element =>/);
  assert.match(watchdog, /const scopedButton = scopedControls\.find\(isEnterFullscreenControl\)/);
  assert.match(watchdog, /Array\.from\(document\.querySelectorAll\(selector\)\)/);
  assert.match(watchdog, /__homePanelTverFullscreenRecovery/);
  assert.match(watchdog, /fullscreenRecovery\.attempts/);
  assert.match(watchdog, /controlPoint && attempts < 3/);
  assert.match(watchdog, /attempts < 7/);
  assert.match(watchdog, /requestFullscreen|webkitRequestFullscreen|msRequestFullscreen/);
  assert.match(watchdog, /request\.call\(target\)/);
  assert.doesNotMatch(loop, /fullscreenAttemptCount|fullscreenKeyRequestedAt/);
  assert.doesNotMatch(watchdog, /const videoFullscreenPoint = media =>/);
  assert.doesNotMatch(watchdog, /const fullscreenPoint = videoFullscreenPoint\(video\)/);
});

test('healthy TVer watchdog only enumerates fullscreen controls while recovery is dirty', () => {
  assert.match(watchdog, /if \(!video \|\| video\.paused\)/);
  assert.doesNotMatch(watchdog, /const playerControls = \(\) =>/);
  const fullscreenRecovery = watchdog.indexOf('const fullscreenControlPoint = media =>');
  const healthyFastPath = watchdog.indexOf('const trackedVideo = state && state.video');
  assert.ok(fullscreenRecovery >= 0 && healthyFastPath > fullscreenRecovery);
  assert.doesNotMatch(watchdog, /isExitFullscreenControl/);
  assert.doesNotMatch(
    watchdog,
    /Array\.from\(document\.querySelectorAll\(\s*'button, \[role="button"\], a, \[aria-label\], \[title\]'/,
  );
});
