import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferVideoOrientation,
  matchesOrientation,
  normalizeOrientation
} from '../public/video-orientation.js';
import {
  inferVideoOrientation as inferServerOrientation,
  matchesVideoOrientationFilter,
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

test('player profiles split by orientation and short-edge resolution', () => {
  const vertical720 = 'https://cdn.example/video/720x1280/a.mp4';
  const vertical1080 = 'https://cdn.example/video/1080x1920/b.mp4';
  const horizontal720 = 'https://cdn.example/video/1920x1079/c.mp4';
  const horizontal1080 = 'https://cdn.example/video/1920x1080/d.mp4';

  assert.equal(matchesOrientation(vertical720, 'vertical-720'), true);
  assert.equal(matchesOrientation(vertical720, 'vertical-1080'), false);
  assert.equal(matchesOrientation(vertical1080, 'vertical-1080'), true);
  assert.equal(matchesOrientation(horizontal720, 'horizontal-720'), true);
  assert.equal(matchesOrientation(horizontal720, 'horizontal-1080'), false);
  assert.equal(matchesOrientation(horizontal1080, 'horizontal-1080'), true);

  assert.equal(matchesVideoOrientationFilter(vertical720, 'vertical-720'), true);
  assert.equal(matchesVideoOrientationFilter(vertical720, 'vertical-1080'), false);
  assert.equal(matchesVideoOrientationFilter(vertical1080, 'vertical-1080'), true);
  assert.equal(matchesVideoOrientationFilter(horizontal720, 'horizontal-720'), true);
  assert.equal(matchesVideoOrientationFilter(horizontal720, 'horizontal-1080'), false);
  assert.equal(matchesVideoOrientationFilter(horizontal1080, 'horizontal-1080'), true);
});

test('legacy player choices migrate to 720 profiles while server API remains compatible', () => {
  const vertical = 'https://cdn.example/video/720x1280/a.mp4';
  const horizontal = 'https://cdn.example/video/1280x720/b.mp4';
  const unknown = 'https://cdn.example/video/c.mp4';

  assert.equal(normalizeOrientation('vertical'), 'vertical-720');
  assert.equal(normalizeOrientation('horizontal'), 'horizontal-720');
  assert.equal(normalizeOrientation('both'), 'vertical-720');
  assert.equal(normalizeOrientation('nonsense'), 'vertical-720');

  assert.equal(normalizeVideoOrientationFilter('vertical'), 'vertical');
  assert.equal(normalizeVideoOrientationFilter('horizontal'), 'horizontal');
  assert.equal(normalizeVideoOrientationFilter('square'), 'both');
  assert.equal(normalizeVideoOrientationFilter('vertical-1080'), 'vertical-1080');
  assert.equal(matchesVideoOrientationFilter(vertical, 'vertical'), true);
  assert.equal(matchesVideoOrientationFilter(horizontal, 'horizontal'), true);
  assert.equal(matchesVideoOrientationFilter(unknown, 'both'), true);
});

test('client profile filters are trimmed and case-insensitive', () => {
  const vertical = 'https://cdn.example/video/720x1280/a.mp4';

  assert.equal(normalizeOrientation(' Vertical-720 '), 'vertical-720');
  assert.equal(normalizeOrientation('HORIZONTAL-1080'), 'horizontal-1080');
  assert.equal(normalizeOrientation(null), 'vertical-720');
  assert.equal(matchesOrientation(vertical, ' Vertical-720 '), true);
});
