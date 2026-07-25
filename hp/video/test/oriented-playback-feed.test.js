import assert from 'node:assert/strict';
import test from 'node:test';

import {
  invalidateOrientationPlaybackCache,
  readOrientationPlaybackCursorPage
} from '../src/oriented-playback-feed.js';

function mediaUrl(id, orientation) {
  const dimensions = orientation === 'vertical' ? '720x1280' : '1280x720';
  return `https://cdn.example/video/${dimensions}/${id}.mp4`;
}

function rows(count, orientation, start = 1) {
  return Array.from({ length: count }, (_, index) => {
    const id = start + index;
    return {
      id,
      shuffleKey: id,
      mediaUrl: mediaUrl(id, orientation)
    };
  });
}

function createDb(upperRows, lowerRows = []) {
  const db = {
    reads: 0,
    requested: [],
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
          const source = normalized.includes(' >= ?') ? upperRows : lowerRows;
          const limit = Number(this.args.at(-1));
          const cursorVideoId = this.args.length > 2
            ? Number(this.args.at(-2))
            : 0;
          const result = source
            .filter((row) => row.id > cursorVideoId)
            .slice(0, limit);
          db.reads += 1;
          db.requested.push(limit);
          db.sql.push(normalized);
          return { results: result };
        }
      };
    }
  };
  return db;
}

test('orientation playback infers bounded candidates without metadata backfill writes', async () => {
  const candidates = [
    { id: 1, shuffleKey: 1, mediaUrl: mediaUrl(1, 'vertical') },
    { id: 2, shuffleKey: 2, mediaUrl: mediaUrl(2, 'horizontal') },
    { id: 3, shuffleKey: 3, mediaUrl: mediaUrl(3, 'vertical') },
    { id: 4, shuffleKey: 4, mediaUrl: mediaUrl(4, 'horizontal') }
  ];
  const db = createDb(candidates);

  const page = await readOrientationPlaybackCursorPage(db, {
    orientation: 'vertical',
    seed: 17,
    cursor: 'start',
    limit: 2
  });

  assert.deepEqual(page.items.map((row) => row.id), [1, 3]);
  assert.equal(typeof page.nextCursor, 'string');
  assert.ok(db.sql.every((sql) => !sql.includes('video_orientations')));
  assert.ok(db.sql.every((sql) => !sql.includes('COUNT(*)')));
  assert.ok(db.sql.every((sql) => !sql.includes('OFFSET')));
  assert.ok(db.sql.every((sql) => sql.startsWith('SELECT video.id')));
});

test('orientation playback stops after 100 scanned candidates and resumes by cursor', async () => {
  const candidates = [
    ...rows(200, 'horizontal'),
    { id: 201, shuffleKey: 201, mediaUrl: mediaUrl(201, 'vertical') }
  ];
  const db = createDb(candidates);
  const options = {
    orientation: 'vertical',
    seed: 17,
    cursor: 'start',
    limit: 100
  };

  const first = await readOrientationPlaybackCursorPage(db, options);
  assert.deepEqual(first.items, []);
  assert.equal(typeof first.nextCursor, 'string');
  assert.ok(db.requested.every((limit) => limit <= 101));

  const second = await readOrientationPlaybackCursorPage(db, {
    ...options,
    cursor: first.nextCursor
  });
  assert.deepEqual(second.items, []);
  assert.equal(typeof second.nextCursor, 'string');

  const third = await readOrientationPlaybackCursorPage(db, {
    ...options,
    cursor: second.nextCursor
  });
  assert.deepEqual(third.items.map((row) => row.id), [201]);
  assert.equal(third.nextCursor, null);

  invalidateOrientationPlaybackCache(db, { resetMetadata: true });
  assert.ok(db.sql.every((sql) => !sql.includes('INSERT INTO video_orientations')));
});
