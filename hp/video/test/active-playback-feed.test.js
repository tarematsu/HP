import assert from 'node:assert/strict';
import test from 'node:test';

import { readAllActivePlaybackCursorPage } from '../src/active-playback-feed.js';

function mediaUrl(id, orientation = 'horizontal') {
  const dimensions = orientation === 'vertical' ? '720x1280' : '1280x720';
  return `https://cdn.example/video/${dimensions}/${id}.mp4`;
}

function createDb(rows) {
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
          const [afterVideoId, limit] = this.args.map(Number);
          return {
            results: rows
              .filter((row) => row.status === 'active' && row.id > afterVideoId)
              .slice(0, limit)
              .map(({ id, mediaUrl }) => ({ id, mediaUrl }))
          };
        }
      };
    }
  };
  return db;
}

test('all-active paging exhausts more than the former 2000-video cap without duplicates', async () => {
  const rows = Array.from({ length: 2105 }, (_, index) => ({
    id: index + 1,
    mediaUrl: mediaUrl(index + 1),
    status: 'active'
  }));
  const db = createDb(rows);
  const ids = [];
  let cursor = 'start';

  do {
    const page = await readAllActivePlaybackCursorPage(db, {
      orientation: 'both',
      cursor,
      limit: 100
    });
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(ids.length, 2105);
  assert.equal(new Set(ids).size, 2105);
  assert.equal(ids[0], 1);
  assert.equal(ids.at(-1), 2105);
  assert.ok(db.sql.every((sql) => sql.includes("video.status = 'active'")));
  assert.ok(db.sql.every((sql) => !sql.includes('ranking_entries')));
  assert.ok(db.sql.every((sql) => !sql.includes('OFFSET')));
});

test('orientation paging advances across non-matching active videos without skipping matches', async () => {
  const rows = [
    ...Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      mediaUrl: mediaUrl(index + 1, 'horizontal'),
      status: 'active'
    })),
    { id: 202, mediaUrl: mediaUrl(202, 'vertical'), status: 'active' },
    { id: 203, mediaUrl: mediaUrl(203, 'vertical'), status: 'hidden' }
  ];
  const db = createDb(rows);

  const first = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical',
    cursor: 'start',
    limit: 100
  });
  assert.deepEqual(first.items, []);
  assert.equal(first.nextCursor, '100');

  const second = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical',
    cursor: first.nextCursor,
    limit: 100
  });
  assert.deepEqual(second.items, []);
  assert.equal(second.nextCursor, '200');

  const third = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical',
    cursor: second.nextCursor,
    limit: 100
  });
  assert.deepEqual(third.items.map((item) => item.id), [202]);
  assert.equal(third.nextCursor, null);
});
