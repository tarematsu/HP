import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlaybackBag,
  parsePlaybackBag,
  parseRecentPlaybackIds,
  playbackBagAfterIndex,
  rememberRecentPlaybackId,
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


test('recent playback history persists at most thirty unique video IDs', () => {
  let recent = [];
  for (let id = 1; id <= 32; id++) recent = rememberRecentPlaybackId(recent, { id });
  assert.equal(recent.length, 30);
  assert.deepEqual(recent.slice(0, 3), ['32', '31', '30']);
  recent = rememberRecentPlaybackId(recent, { id: 30 });
  assert.equal(recent[0], '30');
  assert.equal(new Set(recent).size, 30);
  assert.deepEqual(parseRecentPlaybackIds(JSON.stringify(recent)), recent);
  assert.deepEqual(parseRecentPlaybackIds('{invalid json'), []);
  assert.deepEqual(parseRecentPlaybackIds(null), []);
});

test('a fresh shuffle defers recent plays only within a bounded prefix', () => {
  const items = Array.from({ length: 80 }, (_, index) => ({ id: index + 1 }));
  const bag = createPlaybackBag(items, 77, null, 0, ['1', '2', '3', '78']);
  assert.deepEqual(bag.remainingIds.slice(0, 57),
    Array.from({ length: 57 }, (_, index) => String(index + 4)));
  assert.deepEqual(bag.remainingIds.slice(57, 61), ['1', '2', '3', '61']);
  assert.equal(bag.remainingIds.indexOf('78'), 77);
  assert.equal(new Set(bag.remainingIds).size, 80);
});

test('a small library favors the unseen clip at the start of a fresh round', () => {
  const items = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(createPlaybackBag(items, 77, null, 0, ['1']).remainingIds, ['2', '1']);
  assert.deepEqual(createPlaybackBag([{ id: 1 }], 77, null, 0, ['1']).remainingIds, ['1']);
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
