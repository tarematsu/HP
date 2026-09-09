import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const loop = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url),
  'utf8',
);
const watchdog = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url),
  'utf8',
);

test('episode pages replace the legacy global TVer loop with the bounded policy', () => {
  assert.match(wrapper, /#include "media_tver_episode_loop_policy\.inc"/);
  assert.match(
    wrapper,
    /script == kNativeMediaTverLoopScript &&[\s\S]*tver\.jp\/episodes\/[\s\S]*return kNativeMediaTverEpisodeLoopPolicyScript/,
  );
});

test('TVer episode ad detection is bounded to the player subtree', () => {
  assert.match(loop, /const playerRootFor = video =>/);
  assert.match(loop, /depth < 5/);
  assert.match(loop, /root\.querySelectorAll\(selectors\.join\(','\)\)/);
  assert.doesNotMatch(
    loop,
    /document\.querySelectorAll\(selectors\.join\(','\)\)/,
  );
});

test('known TVer ads use media facts before any DOM marker scan', () => {
  const activeIndex = loop.indexOf('if (state.adActive)');
  const markerIndex = loop.indexOf('return explicitAdMarker(video)', activeIndex);
  assert.ok(activeIndex >= 0);
  assert.ok(markerIndex > activeIndex);
  assert.match(loop, /if \(shortAdLength && !video\.ended\) return true/);
});

test('TVer quality control discovery is one-shot and player-local', () => {
  assert.match(loop, /if \(!state\.lowQualitySet\)/);
  assert.match(loop, /const root = playerRootFor\(video\)/);
  assert.match(loop, /for \(const element of root\.querySelectorAll\(/);
});

test('healthy TVer watchdog avoids page-wide control enumeration', () => {
  assert.match(watchdog, /const surveyRoots = Array\.from\(document\.querySelectorAll/);
  assert.match(watchdog, /const playerControls = \(\) =>/);
  assert.match(watchdog, /const root = playerRootFor\(video\)/);
  assert.doesNotMatch(
    watchdog,
    /Array\.from\(document\.querySelectorAll\(\s*'button, \[role="button"\], a, \[aria-label\], \[title\]'/,
  );
});