import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('YouTube ads settle before fullscreen and skip lookup', () => {
  const adBranch = runtime.indexOf('if (ad()) {');
  const fullscreen = runtime.indexOf('const action = armFullscreen()', adBranch);
  const skip = runtime.indexOf('const skipSelectors = [', adBranch);
  const guard = runtime.indexOf("return 'recovery';", skip);
  assert.ok(adBranch >= 0 && fullscreen > adBranch && skip > fullscreen && guard > skip);
  assert.match(runtime, /state\.adFullscreenReadyAt = now \+ fullscreenSettleMs/);
  assert.match(runtime, /now >= Number\(state\.adFullscreenReadyAt \|\| 0\)/);
});

test('trusted fullscreen remains valid during ads', () => {
  assert.match(runtime, /action !== 'fullscreen' \|\| !fullscreen\(\)/);
  assert.doesNotMatch(runtime, /action !== 'fullscreen' \|\| \(!ad\(\)/);
  assert.match(runtime, /return arm\(target, 'fullscreen', 1200\)/);
});