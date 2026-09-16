import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const wrapper = read('../../native/src/renderer_panels/media_section.inc');
const youtube = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const tver = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const tverVerify = read(
  '../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc');

test('YouTube fullscreen uses trusted F key input through WebView2', () => {
  assert.match(wrapper, /Input\.dispatchKeyEvent/);
  assert.match(wrapper, /keyDown/);
  assert.match(wrapper, /keyUp/);
  assert.match(wrapper, /KeyF/);
  assert.match(wrapper, /windowsVirtualKeyCode/);
  assert.match(wrapper, /nativeVirtualKeyCode/);
  assert.match(wrapper, /querySelector\('#movie_player'\)/);
});

test('YouTube requests F before falling back to fullscreen button click', () => {
  const request = youtube.slice(
    youtube.indexOf('const requestFullscreen = () =>'),
    youtube.indexOf('state.fullscreenApplied = fullscreen();'),
  );
  const key = request.indexOf('homepanel:youtube-fullscreen-key');
  const fallback = request.indexOf('armFullscreen()');
  assert.ok(key >= 0 && fallback > key);
  assert.match(request, /fullscreenKeyRequestedAt/);
  assert.match(request, /wake\(1200\)/);
  assert.match(youtube, /\.ytp-fullscreen-button/);
  assert.doesNotMatch(youtube, /const videoFullscreenPoint = media =>/);
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

test('TVer requests fullscreen before ad-specific controls', () => {
  const fullscreen = tver.indexOf('const fullscreenPoint = videoFullscreenPoint(video)');
  const ad = tver.indexOf('if (adActive) {');
  assert.ok(fullscreen >= 0 && ad > fullscreen);
});

test('YouTube key messages remain source checked and TVer click verification rearms fallback', () => {
  assert.match(wrapper, /homepanel:youtube-fullscreen-key/);
  assert.match(wrapper, /sourceContains\(L"youtube\.com\/watch"\)/);
  assert.match(tverVerify, /homepanel:tver-wake/);
  assert.match(tverVerify, /fullscreenDirty = true/);
});
