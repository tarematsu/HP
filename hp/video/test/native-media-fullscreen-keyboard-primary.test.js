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

test('TVer mirrors YouTube with trusted fullscreen request then labelled-button fallback', () => {
  const request = tver.slice(
    tver.indexOf('const requestFullscreen = () =>'),
    tver.indexOf('if (adActive) {'),
  );
  const key = request.indexOf("post('homepanel:tver-fullscreen-key')");
  const fallback = request.indexOf("arm(fullscreenControl(), 'fullscreen', 1200)");
  assert.ok(key >= 0 && fallback > key);
  assert.match(request, /fullscreenKeyRequestedAt/);
  assert.match(request, /wake\(1200\)/);
  assert.match(tver, /全画面\|フルスクリーン\|fullscreen\|full screen/);
  assert.match(tver, /document\.elementFromPoint/);
  assert.doesNotMatch(tver, /__homePanelTverFullscreenRecovery|fullscreenAttemptCount/);
});

test('TVer ads prioritize Skip and only use fullscreen recovery when Skip is unavailable', () => {
  const ad = tver.indexOf('if (adActive) {');
  const skip = tver.indexOf("arm(skip, 'skip-ad', 600)", ad);
  const fullscreen = tver.indexOf('if (!fullscreen()) return requestFullscreen();', skip);
  assert.ok(ad >= 0 && skip > ad && fullscreen > skip);
});

test('fullscreen key messages stay source checked and TVer verification only rearms runtime', () => {
  assert.match(wrapper, /homepanel:youtube-fullscreen-key/);
  assert.match(wrapper, /sourceContains\(L"youtube\.com\/watch"\)/);
  assert.match(wrapper, /homepanel:tver-fullscreen-key/);
  assert.match(wrapper, /sourceContains\(L"tver\.jp\/episodes\/"\)/);
  assert.match(tverVerify, /homepanel:tver-wake/);
  assert.match(tverVerify, /fullscreenKeyRequestedAt = 0/);
  assert.doesNotMatch(tverVerify, /requestFullscreen|webkitRequestFullscreen|__homePanelTverFullscreenRecovery/);
});
