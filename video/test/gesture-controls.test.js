import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gestureAxes,
  isLandscapeLayout,
  seekGestureDeltaSeconds
} from '../public/gesture-layout.js';
import { videoSessionKey } from '../public/playback-gestures.js';

function seekDelta(deltaX, viewportWidth, duration) {
  return seekGestureDeltaSeconds(deltaX, 0, viewportWidth, 1, duration, false);
}

test('horizontal seek distance maps proportionally to playback time', () => {
  assert.equal(seekDelta(180, 360, 60), 30);
  assert.equal(seekDelta(-90, 360, 60), -15);
  assert.equal(seekDelta(360, 360, 600), 120);
  assert.equal(seekDelta(0, 360, 60), 0);
});

test('short videos use their duration as the full-width seek range', () => {
  assert.equal(seekDelta(160, 320, 20), 10);
});

test('viewport dimensions override stale mobile orientation metadata', () => {
  assert.equal(isLandscapeLayout(844, 390, 'portrait-primary'), true);
  assert.equal(isLandscapeLayout(390, 844, 'landscape-primary'), false);
});

test('orientation metadata remains a fallback when viewport dimensions are unavailable', () => {
  assert.equal(isLandscapeLayout(0, 0, 'landscape-primary'), true);
  assert.equal(isLandscapeLayout(0, 0, 'portrait-primary'), false);
});

test('landscape controls use horizontal navigation and vertical seeking', () => {
  assert.deepEqual(gestureAxes(isLandscapeLayout(844, 390, 'portrait-primary')), {
    nextAxis: 'x',
    seekAxis: 'y'
  });
});

test('session key includes origin, path, and query', () => {
  assert.equal(
    videoSessionKey('https://media.example.test/path/720x1280/a.mp4?tag=12'),
    'https://media.example.test/path/720x1280/a.mp4?tag=12'
  );
});
