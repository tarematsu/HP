import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('YouTube ad handling precedes content settings', () => {
  const adStart = runtime.indexOf('if (ad()) {');
  const contentStart = runtime.indexOf('const currentTime = Number(video?.currentTime);');
  assert.ok(adStart >= 0 && contentStart > adStart);
  const adBranch = runtime.slice(adStart, contentStart);
  assert.match(adBranch, /skipSelector/);
  assert.match(adBranch, /arm\(target, 'skip-ad', 600\)/);
  assert.match(adBranch, /return requestFullscreen\(\)/);
  assert.doesNotMatch(adBranch, /setPlaybackQuality|video\.play\(|setOption\('captions'/);
});

test('YouTube content quality is one-shot 720p and never read back', () => {
  assert.match(runtime, /window\.__homePanelYoutubeRuntime/);
  assert.match(runtime, /qualityApplied: false/);
  assert.match(runtime, /if \(!state\.qualityApplied\)/);
  assert.match(runtime, /const preferredQuality = 'hd720'/);
  assert.doesNotMatch(runtime, /getPlaybackQuality\(\)/);
});

test('YouTube error discovery stays player-local', () => {
  assert.match(runtime, /player\.classList\.contains\('ytp-error'\)/);
  assert.doesNotMatch(runtime, /document\.querySelectorAll\(\s*'\.ytp-error/);
});
