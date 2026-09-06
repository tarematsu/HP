import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlaybackBag,
  parsePlaybackBag,
  playbackBagAfterIndex,
  restorePlaybackBagItems
} from '../public/playback-bag.js';

test('playback bag contains every item exactly once', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ id: index + 1 }));
  const bag = createPlaybackBag(items, 12345);
  assert.equal(bag.remainingIds.length, items.length);
  assert.equal(new Set(bag.remainingIds).size, items.length);
  assert.deepEqual([...bag.remainingIds].sort(), items.map((item) => String(item.id)).sort());
});

test('playback bag preserves the weighted order returned by the server', () => {
  const items = [{ id: 9 }, { id: 3 }, { id: 12 }, { id: 1 }];
  const bag = createPlaybackBag(items, 77);
  assert.deepEqual(bag.remainingIds, ['9', '3', '12', '1']);
});

test('previously played video is moved away from the first position without reshuffling others', () => {
  const items = [{ id: 9 }, { id: 3 }, { id: 12 }, { id: 1 }];
  const bag = createPlaybackBag(items, 77, 9, 2);
  assert.deepEqual(bag.remainingIds, ['3', '12', '9', '1']);
});

test('restored bag keeps saved order and ignores videos added mid-round', () => {
  const bag = {
    version: 1,
    seed: 77,
    remainingIds: ['3', '1'],
    lastPlayedId: '2'
  };
  const currentItems = [
    { id: 1, mediaUrl: 'one' },
    { id: 2, mediaUrl: 'two' },
    { id: 3, mediaUrl: 'three' },
    { id: 4, mediaUrl: 'new-video' }
  ];
  assert.deepEqual(
    restorePlaybackBagItems(currentItems, bag).map((item) => item.id),
    [3, 1]
  );
});

test('videos removed during a round are skipped while remaining order is preserved', () => {
  const bag = {
    version: 1,
    seed: 91,
    remainingIds: ['4', '2', '1'],
    lastPlayedId: '3'
  };
  const currentItems = [{ id: 1 }, { id: 4 }];
  assert.deepEqual(restorePlaybackBagItems(currentItems, bag).map((item) => item.id), [4, 1]);
});

test('consuming through an index persists only the unseen suffix', () => {
  const items = [{ id: 8 }, { id: 5 }, { id: 2 }, { id: 9 }];
  assert.deepEqual(playbackBagAfterIndex(items, 1, 55), {
    version: 1,
    seed: 55,
    remainingIds: ['2', '9'],
    lastPlayedId: '5'
  });
});

test('invalid saved state is rejected', () => {
  assert.equal(parsePlaybackBag('{broken'), null);
  assert.equal(parsePlaybackBag({ version: 1, seed: 0, remainingIds: [] }), null);
});
