import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('YouTube ads attempt fullscreen immediately before skip lookup', () => {
  const adBranch = runtime.indexOf('if (ad()) {');
  const fullscreen = runtime.indexOf('const action = armFullscreen()', adBranch);
  const skip = runtime.indexOf('const skipSelector =', adBranch);
  const guard = runtime.indexOf("return 'recovery';", skip);
  assert.ok(adBranch >= 0 && fullscreen > adBranch && skip > fullscreen && guard > skip);
  assert.doesNotMatch(runtime, /adFullscreenReadyAt|fullscreenSettleMs/);
});

test('normal YouTube fullscreen has no fixed readiness deadline', () => {
  assert.doesNotMatch(runtime, /fullscreenReadyAt/);
  assert.match(runtime, /const fullscreenAction = armFullscreen\(\);/);
  assert.match(runtime, /if \(fullscreenAction\) return fullscreenAction;/);
});

test('trusted fullscreen remains valid during ads', () => {
  assert.match(runtime, /action !== 'fullscreen' \|\| !fullscreen\(\)/);
  assert.doesNotMatch(runtime, /action !== 'fullscreen' \|\| \(!ad\(\)/);
  assert.match(runtime, /return arm\(target, 'fullscreen', 1200\)/);
});
