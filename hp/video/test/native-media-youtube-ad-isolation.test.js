import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const recovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('YouTube ad branch is isolated from content mutation', () => {
  const adStart = recovery.indexOf('if (trusted.ad()) {');
  const contentState = recovery.indexOf('const state = window.__homePanelYoutubeRecoveryState');
  assert.ok(adStart >= 0 && contentState > adStart);
  const adBranch = recovery.slice(adStart, contentState);
  assert.match(adBranch, /const roots = player\.querySelectorAll/);
  assert.match(adBranch, /skipSelectors/);
  assert.match(adBranch, /trusted\.arm\(target, 'skip-ad', 600\)/);
  assert.match(adBranch, /armFullscreen\(\)/);
  assert.doesNotMatch(adBranch, /setPlaybackQuality/);
  assert.doesNotMatch(adBranch, /video\.play\(/);
  assert.doesNotMatch(adBranch, /setOption\('captions'/);
});

test('YouTube content quality is one-shot 360p and never touched during ads', () => {
  const contentState = recovery.indexOf('const state = window.__homePanelYoutubeRecoveryState');
  const preferred = recovery.indexOf("const preferredQuality = 'medium'", contentState);
  assert.ok(contentState >= 0 && preferred > contentState);
  assert.match(recovery, /qualityApplied: false/);
  assert.match(recovery, /if \(!state\.qualityApplied\)/);
  assert.doesNotMatch(recovery, /getPlaybackQuality\(\)/);
});

test('YouTube error discovery stays player-local', () => {
  assert.match(recovery, /player\.classList\.contains\('ytp-error'\)/);
  assert.doesNotMatch(recovery, /document\.querySelectorAll\(\s*'\.ytp-error/);
});