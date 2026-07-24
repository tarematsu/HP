import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readSeededPlaybackCursorPage,
  seedShufflePivot,
  SHUFFLE_INCREMENT,
  SHUFFLE_MODULUS,
  videoShuffleKey
} from '../src/playback-feed.js';

function legacyOrder(ids, seed) {
  return [...ids].sort((left, right) => {
    const leftKey = (videoShuffleKey(left) + seed * SHUFFLE_INCREMENT) % SHUFFLE_MODULUS;
    const rightKey = (videoShuffleKey(right) + seed * SHUFFLE_INCREMENT) % SHUFFLE_MODULUS;
    return leftKey - rightKey || left - right;
  });
}

function rangeOrder(ids, seed) {
  const pivot = seedShufflePivot(seed);
  return [...ids].sort((left, right) => {
    const leftKey = videoShuffleKey(left);
    const rightKey = videoShuffleKey(right);
    const leftSegment = leftKey >= pivot ? 0 : 1;
    const rightSegment = rightKey >= pivot ? 0 : 1;
    return leftSegment - rightSegment || leftKey - rightKey || left - right;
  });
}

function createPlaybackDb(upperRows, lowerRows) {
  const db = {
    reads: 0,
    sql: [],
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          db.reads += 1;
          db.sql.push(normalized);
          const source = normalized.includes(' < ?') ? lowerRows : upperRows;
          const limit = Number(this.args.at(-1));
          const hasCursor = normalized.includes('ranking.video_id > ?');
          if (!hasCursor) return { results: source.slice(0, limit) };
          const shuffleKey = Number(this.args.at(-4));
          const videoId = Number(this.args.at(-2));
          const rows = source.filter((row) => (
            row.shuffleKey > shuffleKey
            || (row.shuffleKey === shuffleKey && row.id > videoId)
          ));
          return { results: rows.slice(0, limit) };
        }
      };
    }
  };
  return db;
}

test('indexed range order matches the previous seeded expression', () => {
  const ids = Array.from({ length: 200 }, (_, index) => index + 1);
  for (const seed of [1, 2, 17, 999, 2_147_483_646]) {
    assert.deepEqual(rangeOrder(ids, seed), legacyOrder(ids, seed));
  }
});

test('cursor pages wrap once without COUNT or OFFSET pagination', async () => {
  const pivot = seedShufflePivot(17);
  const db = createPlaybackDb(
    [
      { id: 8, shuffleKey: pivot, mediaUrl: 'upper-a' },
      { id: 9, shuffleKey: pivot + 1, mediaUrl: 'upper-b' }
    ],
    [
      { id: 1, shuffleKey: 1, mediaUrl: 'lower-a' },
      { id: 2, shuffleKey: 2, mediaUrl: 'lower-b' }
    ]
  );

  const first = await readSeededPlaybackCursorPage(db, {
    seed: 17,
    cursor: 'start',
    limit: 3
  });
  assert.deepEqual(first.items.map((row) => row.id), [8, 9, 1]);
  assert.equal(first.nextCursor, '1.1.1');

  const second = await readSeededPlaybackCursorPage(db, {
    seed: 17,
    cursor: first.nextCursor,
    limit: 3
  });
  assert.deepEqual(second.items.map((row) => row.id), [2]);
  assert.equal(second.nextCursor, null);
  assert.ok(db.sql.every((sql) => !sql.includes('COUNT(*)')));
  assert.ok(db.sql.every((sql) => !sql.includes('OFFSET')));
});
