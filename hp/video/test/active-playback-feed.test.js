import assert from 'node:assert/strict';
import test from 'node:test';

import { readAllActivePlaybackCursorPage } from '../src/active-playback-feed.js';

function mediaUrl(id, orientation = 'horizontal', resolution = 720) {
  const shortEdge = resolution >= 1080 ? 1080 : 720;
  const longEdge = resolution >= 1080 ? 1920 : 1280;
  const dimensions = orientation === 'vertical'
    ? `${shortEdge}x${longEdge}`
    : `${longEdge}x${shortEdge}`;
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

test('resolution profiles filter by short edge without additional D1 writes', async () => {
  const rows = [
    { id: 1, mediaUrl: mediaUrl(1, 'vertical', 720), status: 'active' },
    { id: 2, mediaUrl: mediaUrl(2, 'vertical', 1080), status: 'active' },
    { id: 3, mediaUrl: mediaUrl(3, 'horizontal', 720), status: 'active' },
    { id: 4, mediaUrl: mediaUrl(4, 'horizontal', 1080), status: 'active' }
  ];
  const db = createDb(rows);

  const vertical720 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical-720', cursor: 'start', limit: 100
  });
  const vertical1080 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical-1080', cursor: 'start', limit: 100
  });
  const horizontal720 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'horizontal-720', cursor: 'start', limit: 100
  });
  const horizontal1080 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'horizontal-1080', cursor: 'start', limit: 100
  });

  assert.deepEqual(vertical720.items.map((item) => item.id), [1]);
  assert.deepEqual(vertical1080.items.map((item) => item.id), [2]);
  assert.deepEqual(horizontal720.items.map((item) => item.id), [3]);
  assert.deepEqual(horizontal1080.items.map((item) => item.id), [4]);
  assert.ok(db.sql.every((sql) => sql.startsWith('SELECT')));
});
