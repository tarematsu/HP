import assert from 'node:assert/strict';
import test from 'node:test';

import { readSeededPlaybackCursorPage } from '../src/playback-feed.js';
import { readOrientationPlaybackCursorPage } from '../src/oriented-playback-feed.js';

function createDb({ rankingUpper = [], rankingLower = [], fallbackRows = [] }) {
  const db = {
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
          db.sql.push(normalized);
          const fallback = normalized.includes('FROM videos AS video');
          const lower = normalized.includes(' < ?');
          const source = fallback ? fallbackRows : (lower ? rankingLower : rankingUpper);
          const limit = Number(this.args.at(-1));
          const hasCursor = normalized.includes('ranking.video_id > ?');
          if (!hasCursor) return { results: source.slice(0, limit) };
          const shuffleKey = Number(this.args.at(-4));
          const videoId = Number(this.args.at(-2));
          return {
            results: source.filter((row) => (
              row.shuffleKey > shuffleKey
              || (row.shuffleKey === shuffleKey && row.id > videoId)
            )).slice(0, limit)
          };
        }
      };
    }
  };
  return db;
}

test('normal playback falls back to active videos when compacted feed is empty', async () => {
  const db = createDb({
    fallbackRows: [
      { id: 12, mediaUrl: 'https://cdn.example/1280x720/12.mp4' },
      { id: 11, mediaUrl: 'https://cdn.example/720x1280/11.mp4' }
    ]
  });

  const page = await readSeededPlaybackCursorPage(db, {
    seed: 17,
    cursor: 'start',
    limit: 2
  });

  assert.deepEqual(page.items.map((row) => row.id), [12, 11]);
  assert.equal(page.nextCursor, null);
  const fallbackSql = db.sql.find((sql) => sql.includes('FROM videos AS video'));
  assert.ok(fallbackSql);
  assert.match(fallbackSql, /video_blocklist/);
  assert.match(fallbackSql, /video_death_list/);
  assert.match(fallbackSql, /ORDER BY video\.id DESC LIMIT \?/);
});

test('normal playback does not use fallback when compacted feed has rows', async () => {
  const db = createDb({
    rankingUpper: [
      { id: 1, shuffleKey: 100, mediaUrl: 'https://cdn.example/720x1280/1.mp4' }
    ],
    fallbackRows: [
      { id: 11, mediaUrl: 'https://cdn.example/720x1280/11.mp4' }
    ]
  });

  const page = await readSeededPlaybackCursorPage(db, {
    seed: 17,
    cursor: 'start',
    limit: 1
  });

  assert.deepEqual(page.items.map((row) => row.id), [1]);
  assert.ok(db.sql.every((sql) => !sql.includes('FROM videos AS video')));
});

test('orientation playback falls back when the compacted feed is empty', async () => {
  const db = createDb({
    fallbackRows: [
      { id: 22, mediaUrl: 'https://cdn.example/video/1280x720/22.mp4' },
      { id: 21, mediaUrl: 'https://cdn.example/video/720x1280/21.mp4' }
    ]
  });

  const page = await readOrientationPlaybackCursorPage(db, {
    orientation: 'vertical',
    seed: 17,
    cursor: 'start',
    limit: 2
  });

  assert.deepEqual(page.items.map((row) => row.id), [21]);
  assert.equal(page.nextCursor, null);
  assert.ok(db.sql.some((sql) => sql.includes('FROM videos AS video')));
});

test('orientation playback does not fall back when compacted candidates exist', async () => {
  const db = createDb({
    rankingUpper: [
      { id: 1, shuffleKey: 100, mediaUrl: 'https://cdn.example/video/1280x720/1.mp4' }
    ],
    fallbackRows: [
      { id: 21, mediaUrl: 'https://cdn.example/video/720x1280/21.mp4' }
    ]
  });

  const page = await readOrientationPlaybackCursorPage(db, {
    orientation: 'vertical',
    seed: 17,
    cursor: 'start',
    limit: 2
  });

  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
  assert.ok(db.sql.every((sql) => !sql.includes('FROM videos AS video')));
});
