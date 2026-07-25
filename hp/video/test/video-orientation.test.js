import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferVideoOrientation,
  matchesOrientation,
  normalizeOrientation
} from '../public/video-orientation.js';
import {
  inferVideoOrientation as inferServerOrientation,
  normalizeVideoOrientationFilter
} from '../src/video-orientation.js';

test('infers orientation from media resolution paths', () => {
  const samples = [
    ['https://cdn.example/ext_media/1/pu/vid/720x1280/a.mp4', 'vertical'],
    ['https://cdn.example/ext_media/1/pu/vid/1280x720/a.mp4', 'horizontal'],
    ['https://cdn.example/ext_media/1/pu/vid/720x720/a.mp4', 'square'],
    ['https://cdn.example/ext_media/1/pu/vid/a.mp4', 'unknown']
  ];
  for (const [url, expected] of samples) {
    assert.equal(inferVideoOrientation(url), expected);
    assert.equal(inferServerOrientation(url), expected);
  }
});

test('both accepts every URL while directional filters are strict', () => {
  const vertical = 'https://cdn.example/video/720x1280/a.mp4';
  const horizontal = 'https://cdn.example/video/1280x720/b.mp4';
  const unknown = 'https://cdn.example/video/c.mp4';

  assert.equal(matchesOrientation(vertical, 'vertical'), true);
  assert.equal(matchesOrientation(vertical, 'horizontal'), false);
  assert.equal(matchesOrientation(horizontal, 'horizontal'), true);
  assert.equal(matchesOrientation(unknown, 'both'), true);
  assert.equal(matchesOrientation(unknown, 'vertical'), false);
  assert.equal(normalizeOrientation('nonsense'), 'both');
  assert.equal(normalizeVideoOrientationFilter('vertical'), 'vertical');
  assert.equal(normalizeVideoOrientationFilter('horizontal'), 'horizontal');
  assert.equal(normalizeVideoOrientationFilter('square'), 'both');
});

test('client orientation filters are trimmed and case-insensitive', () => {
  const vertical = 'https://cdn.example/video/720x1280/a.mp4';

  assert.equal(normalizeOrientation(' Vertical '), 'vertical');
  assert.equal(normalizeOrientation('HORIZONTAL'), 'horizontal');
  assert.equal(normalizeOrientation(null), 'both');
  assert.equal(matchesOrientation(vertical, ' Vertical '), true);
});
