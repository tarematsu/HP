import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFeedSeed,
  shuffleFeedItems
} from '../public/feed-shuffle.js';

test('createFeedSeed maps uint32 input into the accepted API seed range', () => {
  assert.equal(createFeedSeed((buffer) => { buffer[0] = 0; }), 1);
  assert.equal(createFeedSeed((buffer) => { buffer[0] = 0xffffffff; }), 4);
});

test('shuffleFeedItems is stable for a seed and changes order for another seed', () => {
  const items = Array.from({ length: 32 }, (_, index) => ({ id: index + 1 }));
  const first = shuffleFeedItems(items, 12345);
  const repeated = shuffleFeedItems(items, 12345);
  const second = shuffleFeedItems(items, 67890);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, second);
  assert.deepEqual(
    first.map((item) => item.id).sort((left, right) => left - right),
    items.map((item) => item.id)
  );
});

test('previous first video is kept outside the initial playable scan window', () => {
  const items = Array.from({ length: 24 }, (_, index) => ({ id: index + 1 }));
  const previousFirstId = 7;
  const shuffled = shuffleFeedItems(items, 12345, previousFirstId, 12);

  assert.equal(shuffled.slice(0, 12).some((item) => item.id === previousFirstId), false);
  assert.equal(shuffled[12].id, previousFirstId);
});
