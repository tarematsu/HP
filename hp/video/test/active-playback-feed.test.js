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
        async all() {
          db.sql.push(normalized);
          return {
            results: rows
              .filter((row) => row.status === 'active')
              .map(({ id, mediaUrl, firstSeenAt }) => ({ id, mediaUrl, firstSeenAt }))
          };
        }
      };
    }
  };
  return db;
}

function firstSeenAt(daysAgo = 1) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

test('all-active weighted paging exhausts more than 2000 stored videos without duplicates', async () => {
  const rows = Array.from({ length: 2105 }, (_, index) => ({
    id: index + 1,
    mediaUrl: mediaUrl(index + 1),
    firstSeenAt: firstSeenAt(index % 220),
    status: 'active'
  }));
  const db = createDb(rows);
  const ids = [];
  let cursor = 'start';

  do {
    const page = await readAllActivePlaybackCursorPage(db, {
      orientation: 'both',
      cursor,
      seed: 12345,
      limit: 100
    });
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(ids.length, 2105);
  assert.equal(new Set(ids).size, 2105);
  assert.ok(db.sql.every((sql) => sql.includes("video.status = 'active'")));
  assert.ok(db.sql.every((sql) => !sql.includes('ranking_entries')));
  assert.ok(db.sql.every((sql) => !sql.includes('LIMIT')));
  assert.ok(db.sql.every((sql) => !sql.includes('OFFSET')));
});

test('orientation filters apply across the complete active-video set', async () => {
  const rows = [
    ...Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      mediaUrl: mediaUrl(index + 1, 'horizontal'),
      firstSeenAt: firstSeenAt(1),
      status: 'active'
    })),
    { id: 202, mediaUrl: mediaUrl(202, 'vertical'), firstSeenAt: firstSeenAt(1), status: 'active' },
    { id: 203, mediaUrl: mediaUrl(203, 'vertical'), firstSeenAt: firstSeenAt(1), status: 'hidden' }
  ];
  const db = createDb(rows);

  const page = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical',
    cursor: 'start',
    seed: 77,
    limit: 100
  });
  assert.deepEqual(page.items.map((item) => item.id), [202]);
  assert.equal(page.nextCursor, null);
});

test('resolution profiles filter by short edge without additional D1 writes', async () => {
  const rows = [
    { id: 1, mediaUrl: mediaUrl(1, 'vertical', 720), firstSeenAt: firstSeenAt(1), status: 'active' },
    { id: 2, mediaUrl: mediaUrl(2, 'vertical', 1080), firstSeenAt: firstSeenAt(1), status: 'active' },
    { id: 3, mediaUrl: mediaUrl(3, 'horizontal', 720), firstSeenAt: firstSeenAt(1), status: 'active' },
    { id: 4, mediaUrl: mediaUrl(4, 'horizontal', 1080), firstSeenAt: firstSeenAt(1), status: 'active' }
  ];
  const db = createDb(rows);

  const vertical720 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical-720', cursor: 'start', seed: 1, limit: 100
  });
  const vertical1080 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'vertical-1080', cursor: 'start', seed: 1, limit: 100
  });
  const horizontal720 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'horizontal-720', cursor: 'start', seed: 1, limit: 100
  });
  const horizontal1080 = await readAllActivePlaybackCursorPage(db, {
    orientation: 'horizontal-1080', cursor: 'start', seed: 1, limit: 100
  });

  assert.deepEqual(vertical720.items.map((item) => item.id), [1]);
  assert.deepEqual(vertical1080.items.map((item) => item.id), [2]);
  assert.deepEqual(horizontal720.items.map((item) => item.id), [3]);
  assert.deepEqual(horizontal1080.items.map((item) => item.id), [4]);
  assert.ok(db.sql.every((sql) => sql.startsWith('SELECT')));
});
