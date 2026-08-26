import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  clampSeekTime,
  doubleTapSeekSeconds,
  formatMediaTime,
  orientationLockForVideo
} from '../public/player-display.js';

test('formatMediaTime formats short and long durations', () => {
  assert.equal(formatMediaTime(0), '0:00');
  assert.equal(formatMediaTime(65.9), '1:05');
  assert.equal(formatMediaTime(3661), '1:01:01');
  assert.equal(formatMediaTime(Number.NaN), '0:00');
});

test('clampSeekTime supports skipping and duration boundaries', () => {
  assert.equal(clampSeekTime(20, 10, 100), 30);
  assert.equal(clampSeekTime(5, -10, 100), 0);
  assert.equal(clampSeekTime(95, 10, 100), 100);
});

test('portrait double tap zones use the horizontal position', () => {
  assert.equal(doubleTapSeekSeconds(10, 100), -10);
  assert.equal(doubleTapSeekSeconds(50, 100), 0);
  assert.equal(doubleTapSeekSeconds(90, 100), 10);
  assert.equal(doubleTapSeekSeconds(10, 0), 0);
});

test('browser landscape double tap zones use the vertical position', () => {
  assert.equal(doubleTapSeekSeconds(90, 100, 10, 100, true, false), -10);
  assert.equal(doubleTapSeekSeconds(10, 100, 50, 100, true, false), 0);
  assert.equal(doubleTapSeekSeconds(10, 100, 90, 100, true, false), 10);
  assert.equal(doubleTapSeekSeconds(10, 100, 10, 0, true, false), 0);
});

test('native landscape scales absolute Y by its actual coordinate span', () => {
  assert.equal(doubleTapSeekSeconds(10, 100, 5, 50, true, true), -10);
  assert.equal(doubleTapSeekSeconds(10, 100, 25, 50, true, true), 0);
  assert.equal(doubleTapSeekSeconds(10, 100, 45, 50, true, true), 10);
  assert.equal(doubleTapSeekSeconds(10, 100, 5, 0, true, true), 0);
});

test('tap pointerup is captured before competing APK gesture handlers', async () => {
  const source = await readFile(new URL('../public/player-display.js', import.meta.url), 'utf8');
  assert.equal(source.includes('const DOUBLE_TAP_DELAY_MS = 380;'), true);
  assert.equal(source.includes("  }, { capture: true });\n\n  player.addEventListener('pointercancel'"), true);
});

test('orientation lock prefers decoded video dimensions', () => {
  assert.equal(orientationLockForVideo(720, 1280), 'portrait-primary');
  assert.equal(orientationLockForVideo(1920, 1080), 'landscape-primary');
  assert.equal(orientationLockForVideo(720, 720), null);
});

test('orientation lock falls back to resolution in the media URL', () => {
  assert.equal(
    orientationLockForVideo(0, 0, 'https://cdn.example/ext_media/1/pu/vid/720x1280/a.mp4'),
    'portrait-primary'
  );
  assert.equal(
    orientationLockForVideo(0, 0, 'https://cdn.example/ext_media/1/pu/vid/1280x720/a.mp4'),
    'landscape-primary'
  );
  assert.equal(
    orientationLockForVideo(0, 0, 'https://cdn.example/ext_media/1/pu/vid/a.mp4'),
    null
  );
});
