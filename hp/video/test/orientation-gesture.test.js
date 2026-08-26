import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  gestureAxes,
  gestureAxisDelta,
  hiddenTransform,
  isLandscapeLayout,
  landscapeFromRotationAngle,
  seekGestureDeltaSeconds,
  transitionTransform
} from '../public/gesture-layout.js';

test('portrait and landscape layouts swap navigation and seek axes', () => {
  assert.deepEqual(gestureAxes(false), { nextAxis: 'y', seekAxis: 'x' });
  assert.deepEqual(gestureAxes(true), { nextAxis: 'x', seekAxis: 'y' });
  assert.equal(isLandscapeLayout(360, 720, ''), false);
  assert.equal(isLandscapeLayout(720, 360, ''), true);
  assert.equal(isLandscapeLayout(0, 0, 'landscape-primary'), true);
});

test('physical rotation angle overrides stale WebView and native orientation state', () => {
  assert.equal(landscapeFromRotationAngle(90), true);
  assert.equal(landscapeFromRotationAngle(-90), true);
  assert.equal(landscapeFromRotationAngle(270), true);
  assert.equal(landscapeFromRotationAngle(0), false);
  assert.equal(landscapeFromRotationAngle(180), false);
  assert.equal(landscapeFromRotationAngle('unknown'), null);

  assert.equal(isLandscapeLayout(360, 720, 'portrait-primary', false, true), true);
  assert.equal(isLandscapeLayout(720, 360, 'landscape-primary', true, false), false);
});

test('native Android orientation overrides stale WebView state without a rotation angle', () => {
  assert.equal(isLandscapeLayout(360, 720, 'portrait-primary', true), true);
  assert.equal(isLandscapeLayout(720, 360, 'landscape-primary', false), false);
});

test('screen orientation overrides stale WebView viewport dimensions without a native bridge', () => {
  assert.equal(isLandscapeLayout(360, 720, 'landscape-primary'), true);
  assert.equal(isLandscapeLayout(720, 360, 'portrait-primary'), false);
});

test('axis delta follows the selected screen axis', () => {
  assert.equal(gestureAxisDelta('x', 10, 20, 70, 5), 60);
  assert.equal(gestureAxisDelta('y', 10, 20, 70, 5), -15);
});

test('seek distance uses the axis perpendicular to video navigation', () => {
  assert.equal(seekGestureDeltaSeconds(180, 0, 360, 720, 60, false), 30);
  assert.equal(seekGestureDeltaSeconds(0, 180, 720, 360, 60, true), 30);
  assert.equal(seekGestureDeltaSeconds(720, 0, 720, 360, 600, false), 120);
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
