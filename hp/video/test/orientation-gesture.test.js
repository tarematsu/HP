import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  currentLandscapeLayout,
  gestureAxes,
  gestureAxisDelta,
  hiddenTransform,
  isLandscapeLayout,
  landscapeFromRotationAngle,
  seekGestureDeltaSeconds,
  transitionTransform
} from '../public/gesture-layout.js';

test('browser layout swaps navigation and seek axes in landscape', () => {
  assert.deepEqual(gestureAxes(false, false), { nextAxis: 'y', seekAxis: 'x' });
  assert.deepEqual(gestureAxes(true, false), { nextAxis: 'x', seekAxis: 'y' });
  assert.equal(isLandscapeLayout(360, 720, ''), false);
  assert.equal(isLandscapeLayout(720, 360, ''), true);
  assert.equal(isLandscapeLayout(0, 0, 'landscape-primary'), true);
});

test('native Android landscape keeps portrait-fixed physical touch axes', () => {
  assert.deepEqual(gestureAxes(false, true), { nextAxis: 'y', seekAxis: 'x' });
  assert.deepEqual(gestureAxes(true, true), { nextAxis: 'y', seekAxis: 'x' });
  assert.equal(seekGestureDeltaSeconds(180, 0, 720, 360, 60, true, true), 30);
  assert.equal(seekGestureDeltaSeconds(0, 180, 720, 360, 60, true, true), 0);
});

test('APK display rotation overrides stale WebView orientation metadata', () => {
  const previousWindow = globalThis.window;
  const previousScreen = globalThis.screen;
  const previousBridge = globalThis.VideoPlayerNative;
  try {
    globalThis.window = { innerWidth: 360, innerHeight: 720 };
    globalThis.screen = { orientation: { type: 'portrait-primary', angle: 0 } };
    globalThis.VideoPlayerNative = {
      getDisplayRotationDegrees: () => 90,
      isLandscape: () => false,
      usesPortraitFixedTouchAxes: () => true
    };

    assert.equal(currentLandscapeLayout(), true);
    assert.deepEqual(gestureAxes(true), { nextAxis: 'y', seekAxis: 'x' });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousScreen === undefined) delete globalThis.screen;
    else globalThis.screen = previousScreen;
    if (previousBridge === undefined) delete globalThis.VideoPlayerNative;
    else globalThis.VideoPlayerNative = previousBridge;
  }
});

test('native Android orientation overrides stale rotation and WebView state', () => {
  assert.equal(landscapeFromRotationAngle(90), true);
  assert.equal(landscapeFromRotationAngle(-90), true);
  assert.equal(landscapeFromRotationAngle(270), true);
  assert.equal(landscapeFromRotationAngle(0), false);
  assert.equal(landscapeFromRotationAngle(180), false);
  assert.equal(landscapeFromRotationAngle('unknown'), null);

  assert.equal(isLandscapeLayout(360, 720, 'portrait-primary', true, false), true);
  assert.equal(isLandscapeLayout(720, 360, 'landscape-primary', false, true), false);
});

test('rotation angle remains fallback without a native bridge', () => {
  assert.equal(isLandscapeLayout(360, 720, 'portrait-primary', null, true), true);
  assert.equal(isLandscapeLayout(720, 360, 'landscape-primary', null, false), false);
});

test('screen orientation overrides stale WebView viewport dimensions without native metadata', () => {
  assert.equal(isLandscapeLayout(360, 720, 'landscape-primary'), true);
  assert.equal(isLandscapeLayout(720, 360, 'portrait-primary'), false);
});

test('axis delta follows the selected physical axis', () => {
  assert.equal(gestureAxisDelta('x', 10, 20, 70, 5), 60);
  assert.equal(gestureAxisDelta('y', 10, 20, 70, 5), -15);
});

test('browser seek distance uses the axis perpendicular to video navigation', () => {
  assert.equal(seekGestureDeltaSeconds(180, 0, 360, 720, 60, false, false), 30);
  assert.equal(seekGestureDeltaSeconds(0, 180, 720, 360, 60, true, false), 30);
  assert.equal(seekGestureDeltaSeconds(720, 0, 720, 360, 600, false, false), 120);
});

test('transition direction changes with the display orientation', () => {
  assert.equal(transitionTransform(false, -1, true), 'translateY(110%)');
  assert.equal(transitionTransform(true, -1, true), 'translateX(110%)');
  assert.equal(transitionTransform(true, -1, false), 'translateX(-110%)');
  assert.equal(hiddenTransform(false), 'translateY(110%)');
  assert.equal(hiddenTransform(true), 'translateX(110%)');
});

test('player videos no longer loop so ended can advance playback', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal(html.includes(' loop'), false);
  assert.equal(html.includes('app-resilient.js'), true);
  assert.equal(html.includes('playback-gestures.js'), true);
});
