import assert from 'node:assert/strict';
import test from 'node:test';

import { readSeededPlaybackCursorPage } from '../src/playback-feed.js';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  async all() {
    const source = this.sql.includes(' < ?') ? this.db.lowerRows : this.db.upperRows;
    const limit = Number(this.params.at(-1));
    const hasCursor = this.sql.includes('ranking.video_id > ?');
    let rows = source;
    if (hasCursor) {
      const shuffleKey = Number(this.params.at(-4));
      const videoId = Number(this.params.at(-2));
      rows = rows.filter((row) => (
        row.shuffleKey > shuffleKey
        || (row.shuffleKey === shuffleKey && row.id > videoId)
      ));
    }
    this.db.selects.push({ sql: this.sql, params: this.params });
    return { results: rows.slice(0, limit) };
  }
}

class PlaybackDb {
  constructor(upperRows, lowerRows) {
    this.upperRows = upperRows;
    this.lowerRows = lowerRows;
    this.schemaRuns = 0;
    this.selects = [];
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
}

test('cursor playback wraps from the upper shuffle segment to the lower segment', async () => {
  const db = new PlaybackDb(
    [
      { id: 8, shuffleKey: 2_147_480_000, mediaUrl: 'upper-a' },
      { id: 9, shuffleKey: 2_147_480_001, mediaUrl: 'upper-b' }
    ],
    [
      { id: 1, shuffleKey: 1, mediaUrl: 'lower-a' },
      { id: 2, shuffleKey: 2, mediaUrl: 'lower-b' }
    ]
  );
  const page = await readSeededPlaybackCursorPage(db, {
    limit: 3,
    cursor: 'start',
    seed: 7
  });
  assert.deepEqual(page.items.map((row) => row.id), [8, 9, 1]);
  assert.equal(page.nextCursor, '1.1.1');
  assert.equal(db.schemaRuns, 0);
  assert.equal(db.selects.length, 2);
});

test('cursor playback advances without OFFSET or runtime index DDL', async () => {
  const db = new PlaybackDb(
    [
      { id: 10, shuffleKey: 2_147_480_000, mediaUrl: 'u0' },
      { id: 11, shuffleKey: 2_147_480_001, mediaUrl: 'u1' },
      { id: 12, shuffleKey: 2_147_480_002, mediaUrl: 'u2' }
    ],
    [
      { id: 1, shuffleKey: 1, mediaUrl: 'l0' },
      { id: 2, shuffleKey: 2, mediaUrl: 'l1' },
      { id: 3, shuffleKey: 3, mediaUrl: 'l2' }
    ]
  );
  const first = await readSeededPlaybackCursorPage(db, {
    limit: 2,
    cursor: 'start',
    seed: 9
  });
  const second = await readSeededPlaybackCursorPage(db, {
    limit: 2,
    cursor: first.nextCursor,
    seed: 9
  });

  assert.deepEqual(first.items.map((row) => row.id), [10, 11]);
  assert.deepEqual(second.items.map((row) => row.id), [12, 1]);
  assert.ok(db.selects.every((entry) => !entry.sql.includes('OFFSET')));
  assert.ok(db.selects.every((entry) => !entry.sql.includes('COUNT(*)')));
  assert.equal(db.schemaRuns, 0);
});
