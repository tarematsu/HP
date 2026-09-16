import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const watchdog = [
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_main1.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_main2.inc', import.meta.url), 'utf8'),
].join('\n');
const immediateFullscreen = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc', import.meta.url), 'utf8');

test('TVer pauses fullscreen while a visible login prompt is present', () => {
  assert.match(watchdog, /const hasVisibleLoginPrompt = \(\) =>/);
  assert.match(watchdog, /\[role="dialog"\]/);
  assert.match(watchdog, /label\.includes\('ログイン'\)/);
  // The fullscreen branch is gated before returning a trusted-click point, and
  // the later playback watchdog keeps an explicit login short-circuit. Test
  // behavior rather than requiring the same guard spelling twice.
  assert.match(watchdog, /else if \(video && !hasVisibleLoginPrompt\(\)\) \{/);
  assert.match(watchdog, /if \(hasVisibleLoginPrompt\(\)\) return null;/);
});

test('trusted fullscreen keeps its retry pending across login', () => {
  assert.match(
    immediateFullscreen,
    /if \(hasVisibleLoginPrompt\(\)\) \{[\s\S]*if \(state\) state\.fullscreenDirty = true;[\s\S]*return;/,
  );
  assert.match(immediateFullscreen, /homepanel:tver-wake/);
  assert.doesNotMatch(
    immediateFullscreen,
    /requestFullscreen|webkitRequestFullscreen|msRequestFullscreen/,
  );
});
