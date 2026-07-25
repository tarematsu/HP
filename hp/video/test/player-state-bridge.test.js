import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blocksLegacyPointerUp,
  blocksLegacyTap,
  normalizedStoredVolume
} from '../public/player-state-bridge.js';

test('missing stored volume defaults to full volume', () => {
  assert.equal(normalizedStoredVolume(null), 1);
  assert.equal(normalizedStoredVolume(''), 1);
  assert.equal(normalizedStoredVolume('0.35'), 0.35);
  assert.equal(normalizedStoredVolume('2'), 1);
  assert.equal(normalizedStoredVolume('-1'), 0);
});

test('medium drags do not leak into legacy tap handling', () => {
  assert.equal(blocksLegacyTap(27, 0), false);
  assert.equal(blocksLegacyTap(28, 0), true);
  assert.equal(blocksLegacyTap(44, 0), true);
  assert.equal(blocksLegacyTap(45, 0), false);
  assert.equal(blocksLegacyTap(0, -32), true);
});

test('seek-axis drags never reach legacy sound toggling', () => {
  assert.equal(blocksLegacyPointerUp(80, 3, 'y'), true);
  assert.equal(blocksLegacyPointerUp(3, 80, 'x'), true);
  assert.equal(blocksLegacyPointerUp(3, 46, 'y'), false);
  assert.equal(blocksLegacyPointerUp(46, 3, 'x'), false);
  assert.equal(blocksLegacyPointerUp(12, 8, 'y'), false);
});
