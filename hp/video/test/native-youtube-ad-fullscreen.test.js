import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const recovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const trusted = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_trusted_action.inc', import.meta.url), 'utf8');

test('YouTube ads wait for player settle then request fullscreen before skip lookup', () => {
  const adBranch = recovery.indexOf('if (trusted.ad()) {');
  const adState = recovery.indexOf('window.__homePanelYoutubeAdState', adBranch);
  const fullscreen = recovery.indexOf('const action = armFullscreen()', adBranch);
  const skip = recovery.indexOf('const skipSelectors = [', adBranch);
  const guard = recovery.indexOf("return 'recovery';", skip);
  assert.ok(adBranch >= 0);
  assert.ok(adState > adBranch);
  assert.ok(fullscreen > adState);
  assert.ok(skip > fullscreen);
  assert.ok(guard > skip);
  assert.match(recovery, /fullscreenReadyAt: 0/);
  assert.match(recovery, /now >= adState\.fullscreenReadyAt/);
  assert.match(recovery, /const action = armFullscreen\(\);\s*if \(action\) return action;/);
});

test('trusted fullscreen click remains valid while an ad is active', () => {
  assert.match(trusted, /if \(action === 'fullscreen' && fullscreen\(\)\)/);
  assert.doesNotMatch(trusted, /action === 'fullscreen' && .*ad\(\)/);
});