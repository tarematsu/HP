import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const wrapper = read('../../native/src/renderer_panels/media_section.inc');
const youtube = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const tver = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
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
    youtube.indexOf('const adActive = ad();'),
  );
  const key = request.indexOf('homepanel:youtube-fullscreen-key');
  const fallback = request.indexOf('armFullscreen()');
  assert.ok(key >= 0 && fallback > key);
  assert.match(request, /fullscreenKeyRequestedAt/);
  assert.match(request, /wake\(1200\)/);
  assert.match(youtube, /\.ytp-fullscreen-button/);
  assert.doesNotMatch(youtube, /const videoFullscreenPoint = media =>/);
});

test('TVer fullscreen keeps the trusted bottom-right tap as the first attempt', () => {
  const request = tver.slice(
    tver.indexOf('const requestFullscreen = () =>'),
    tver.indexOf('const bindVideo = () =>'),
  );
  assert.match(request, /video\.getBoundingClientRect/);
  assert.match(request, /rect\.right - 12/);
  assert.match(request, /rect\.bottom - 12/);
  assert.match(request, /state\.fullscreenCornerTapAt/);
  assert.match(request, /return \[x, y\]/);
  assert.doesNotMatch(request, /homepanel:tver-fullscreen-key|fullscreenControl/);
  assert.doesNotMatch(tver, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
});

test('TVer ads prioritize Skip and only use fullscreen recovery when Skip is unavailable', () => {
  const ad = tver.indexOf('if (adActive) {');
  const skip = tver.indexOf("arm(skip, 'skip-ad', 600)", ad);
  const fullscreen = tver.indexOf('if (!fullscreen()) return requestFullscreen();', skip);
  assert.ok(ad >= 0 && skip > ad && fullscreen > skip);
});

test('TVer post-click verification escalates through the native fullscreen bridge', () => {
  assert.match(wrapper, /homepanel:youtube-fullscreen-key/);
  assert.match(wrapper, /sourceContains\(L"youtube\.com\/watch"\)/);
  assert.match(wrapper, /homepanel:tver-fullscreen-key/);
  assert.match(wrapper, /sourceContains\(L"tver\.jp\/episodes\/"\)/);
  assert.doesNotMatch(tver, /homepanel:tver-fullscreen-key/);
  assert.match(tverVerify, /homepanel:tver-fullscreen-key/);
  assert.match(tverVerify, /homepanel:tver-wake/);
  assert.match(tverVerify, /fullscreenCornerTapAt = 0/);
  assert.match(tverVerify, /__homePanelTverFullscreenControlGuard/);
  assert.doesNotMatch(tverVerify, /requestFullscreen|webkitRequestFullscreen/);
});
