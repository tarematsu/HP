import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const youtube = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const tver = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const tverVerify = read(
  '../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc');

test('YouTube fullscreen directly clicks the loaded video bottom-right corner', () => {
  assert.match(youtube, /const videoFullscreenPoint = media =>/);
  assert.match(youtube, /media\.readyState < HTMLMediaElement\.HAVE_METADATA/);
  assert.match(youtube, /const x = rect\.right - insetX/);
  assert.match(youtube, /const y = rect\.bottom - insetY/);
  assert.match(youtube, /player\.classList\.contains\('ytp-fullscreen'\)/);
  assert.match(youtube, /if \(!state\.fullscreenApplied\)/);
  assert.match(youtube, /return fullscreenPoint/);
  assert.match(youtube, /wake\(1200\)/);
  assert.doesNotMatch(
    youtube,
    /homepanel:youtube-fullscreen-key|ytp-fullscreen-button|armFullscreen|fullscreenKeyRequestedAt/,
  );
});

test('TVer fullscreen directly clicks the loaded video bottom-right corner', () => {
  assert.match(tver, /const videoFullscreenPoint = media =>/);
  assert.match(tver, /media\.readyState < HTMLMediaElement\.HAVE_METADATA/);
  assert.match(tver, /const rect = media\.getBoundingClientRect\(\)/);
  assert.match(tver, /const x = rect\.right - insetX/);
  assert.match(tver, /const y = rect\.bottom - insetY/);
  assert.match(tver, /const fullscreenPoint = videoFullscreenPoint\(video\)/);
  assert.match(tver, /if \(fullscreenPoint\) return fullscreenPoint/);
  assert.doesNotMatch(tver, /isEnterFullscreenControl|fullscreenButton/);
});

test('TVer and YouTube request fullscreen before ad-specific controls', () => {
  const tverFullscreen = tver.indexOf('const fullscreenPoint = videoFullscreenPoint(video)');
  const tverAd = tver.indexOf('if (adActive) {');
  assert.ok(tverFullscreen >= 0 && tverAd > tverFullscreen);

  const youtubeFullscreen = youtube.indexOf('if (!state.fullscreenApplied)');
  const youtubeAd = youtube.indexOf('if (ad()) {');
  assert.ok(youtubeFullscreen >= 0 && youtubeAd > youtubeFullscreen);
});

test('TVer failed trusted click verification still wakes a retry', () => {
  assert.match(tverVerify, /__homePanelTverFullscreenPending/);
  assert.match(tverVerify, /homepanel:tver-wake/);
  assert.match(tverVerify, /fullscreenDirty = true/);
});
