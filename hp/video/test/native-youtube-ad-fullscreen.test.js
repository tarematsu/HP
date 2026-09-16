import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('YouTube ads prefer an available skip control before fullscreen recovery', () => {
  const adBranch = runtime.indexOf('if (ad()) {');
  const skip = runtime.indexOf('const skipSelector =', adBranch);
  const skipAction = runtime.indexOf("arm(target, 'skip-ad', 600)", skip);
  const fullscreen = runtime.indexOf('return requestFullscreen();', skipAction);
  const guard = runtime.indexOf("return 'recovery';", fullscreen);
  assert.ok(
    adBranch >= 0 && skip > adBranch && skipAction > skip &&
    fullscreen > skipAction && guard > fullscreen);
  assert.doesNotMatch(runtime, /adFullscreenReadyAt|fullscreenSettleMs/);
});

test('normal YouTube fullscreen uses keyboard first without a fixed readiness deadline', () => {
  assert.doesNotMatch(runtime, /fullscreenReadyAt/);
  const requestStart = runtime.indexOf('const requestFullscreen = () =>');
  const requestEnd = runtime.indexOf('state.fullscreenApplied = fullscreen();', requestStart);
  const request = runtime.slice(requestStart, requestEnd);
  const key = request.indexOf('homepanel:youtube-fullscreen-key');
  const fallback = request.indexOf('armFullscreen()');
  assert.ok(requestStart >= 0 && key >= 0 && fallback > key);
});

test('trusted fullscreen fallback remains valid during ads', () => {
  assert.match(runtime, /action !== 'fullscreen' \|\| !fullscreen\(\)/);
  assert.doesNotMatch(runtime, /action !== 'fullscreen' \|\| \(!ad\(\)/);
  assert.match(runtime, /const canonicalAction = arm\(canonical, 'fullscreen', 1200\)/);
  assert.match(runtime, /return arm\(fallback, 'fullscreen', 1200\)/);
});
