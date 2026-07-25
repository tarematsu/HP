import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectPlaybackCursorPage,
  parsePlaybackCursor
} from '../src/playback-cursor.js';

function readFromSegments(segments) {
  return async (phase, cursor, limit) => {
    const rows = segments[phase].filter((row) => {
      if (!cursor) return true;
      return row.shuffleKey > cursor.shuffleKey
        || (row.shuffleKey === cursor.shuffleKey && row.id > cursor.videoId);
    });
    return rows.slice(0, limit);
  };
}

test('playback cursor preserves the wrap phase of the last returned row', async () => {
  const segments = [
    [
      { id: 1, shuffleKey: 2_147_471_302, mediaUrl: 'https://cdn.example/1.mp4' },
      { id: 2, shuffleKey: 2_147_471_303, mediaUrl: 'https://cdn.example/2.mp4' }
    ],
    [
      { id: 3, shuffleKey: 1, mediaUrl: 'https://cdn.example/3.mp4' },
      { id: 4, shuffleKey: 2, mediaUrl: 'https://cdn.example/4.mp4' }
    ]
  ];
  const readPhase = readFromSegments(segments);

  const first = await collectPlaybackCursorPage(2, 'start', readPhase);
  assert.deepEqual(first.rows.map((row) => row.id), [1, 2]);
  assert.equal(first.nextCursor, '0.2147471303.2');

  const second = await collectPlaybackCursorPage(2, first.nextCursor, readPhase);
  assert.deepEqual(second.rows.map((row) => row.id), [3, 4]);
  assert.equal(second.nextCursor, null);
});

test('invalid playback cursors safely restart pagination', () => {
  assert.equal(parsePlaybackCursor('start'), null);
  assert.equal(parsePlaybackCursor('not-a-cursor'), null);
  assert.deepEqual(parsePlaybackCursor('1.42.7'), {
    phase: 1,
    shuffleKey: 42,
    videoId: 7
  });
});
