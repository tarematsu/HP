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
  assert.equal(
    (watchdog.match(/if \(hasVisibleLoginPrompt\(\)\) return null;/g) || []).length,
    2,
  );
});

test('trusted fullscreen keeps its one-shot pending across login', () => {
  assert.match(immediateFullscreen, /if \(hasVisibleLoginPrompt\(\)\) return;/);
  assert.match(
    immediateFullscreen,
    /if \(hasVisibleLoginPrompt\(\)\) \{[\s\S]*if \(state\) state\.fullscreenDirty = true;[\s\S]*return;/,
  );
  assert.match(immediateFullscreen, /Failure is intentionally not retried until the media identity changes/);
});
