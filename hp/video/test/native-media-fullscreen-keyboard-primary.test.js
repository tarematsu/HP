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
const tverEpisode = readExpandedNativeSource(
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

test('TVer prefers the real fullscreen control before trusted F fallback', () => {
  const control = tver.indexOf('const controlPoint = fullscreenControlPoint(video)');
  const key = tver.indexOf('homepanel:tver-fullscreen-key');
  assert.ok(control >= 0 && key > control);
  assert.match(tver, /const isEnterFullscreenControl = element =>/);
  assert.match(tver, /const fullscreenControlPoint = media =>/);
  assert.match(tver, /__homePanelTverFullscreenRecovery/);
  assert.match(tver, /__homePanelTverFullscreenPending/);
  assert.match(tver, /fullscreenRecovery\.requestedAt = Date\.now\(\)/);
  assert.match(tver, /fullscreenRecovery\.attempts = attempts \+ 1/);
  assert.match(tver, /controlPoint && attempts < 3/);
  assert.match(tver, /attempts < 7/);
  assert.match(tver, /const scopedButton = scopedControls\.find\(isEnterFullscreenControl\)/);
  assert.match(tver, /Array\.from\(document\.querySelectorAll\(selector\)\)/);
  assert.doesNotMatch(tverEpisode, /fullscreenAttemptCount|fullscreenKeyRequestedAt/);
  assert.doesNotMatch(tver, /const videoFullscreenPoint = media =>/);
  assert.doesNotMatch(tver, /const fullscreenPoint = videoFullscreenPoint\(video\)/);
});

test('TVer requests fullscreen before ad-specific controls', () => {
  const fullscreen = tver.indexOf('const controlPoint = fullscreenControlPoint(video)');
  const ad = tver.indexOf('if (adActive) {');
  assert.ok(fullscreen >= 0 && ad > fullscreen);
});

test('YouTube key messages remain source checked and TVer verification rearms fallback', () => {
  assert.match(wrapper, /homepanel:youtube-fullscreen-key/);
  assert.match(wrapper, /sourceContains\(L"youtube\.com\/watch"\)/);
  assert.match(tverVerify, /homepanel:tver-wake/);
  assert.match(tverVerify, /fullscreenDirty = true/);
  assert.match(tverVerify, /__homePanelTverFullscreenRecovery/);
  assert.match(tverVerify, /requestFullscreen|webkitRequestFullscreen|msRequestFullscreen/);
});
