import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planPlaybackFeedChanges,
  rebuildPlaybackFeed
} from '../src/source-feed-unlimited.js';

function statement(db, sql) {
  return {
    sql: sql.replace(/\s+/g, ' ').trim(),
    args: [],
    bind(...args) {
      this.args = args;
      return this;
    },
    async first() {
      if (
        this.sql.startsWith('UPDATE playback_feed_state')
        && this.sql.includes('RETURNING content_hash AS contentHash')
      ) {
        const [token, lockedAt, , staleBefore] = this.args;
        const lockActive = String(db.state.contentHash || '').startsWith('finalizing:')
          && db.state.updatedAt
          && db.state.updatedAt > staleBefore;
        if (lockActive) return null;
        db.state.contentHash = token;
        db.state.updatedAt = lockedAt;
        db.state.version += 1;
        return { contentHash: token };
      }
      if (this.sql.startsWith('SELECT content_hash AS contentHash')) return { ...db.state };
      return null;
    },
    async run() {
      db.runs.push(this);

      if (this.sql.includes('AND version=?')) {
        const [token, lockedAt, expectedVersion] = this.args;
        if (db.state.version !== expectedVersion || String(db.state.contentHash || '').startsWith('finalizing:')) {
          return { meta: { changes: 0 } };
        }
        db.state.contentHash = token;
        db.state.updatedAt = lockedAt;
        db.state.version += 1;
        return { meta: { changes: 1 } };
      }

      if (this.sql.includes('SET content_hash=?, row_count=?')) {
        const [contentHash, rowCount, updatedAt, token] = this.args;
        if (db.state.contentHash !== token) return { meta: { changes: 0 } };
        db.state.contentHash = contentHash;
        db.state.rowCount = rowCount;
        db.state.updatedAt = updatedAt;
        db.state.version += 1;
        return { meta: { changes: 1 } };
      }

      if (this.sql.includes('SET content_hash=NULL')) {
        const [updatedAt, token] = this.args;
        if (db.state.contentHash !== token) return { meta: { changes: 0 } };
        db.state.contentHash = null;
        db.state.updatedAt = updatedAt;
        db.state.version += 1;
        return { meta: { changes: 1 } };
      }

      return { meta: { changes: 1 } };
    }
  };
}

function createFeedDb(desiredRows, currentRows) {
  const batches = [];
  const runs = [];
  return {
    batches,
    runs,
    state: {
      contentHash: null,
      rowCount: 0,
      version: 0,
      updatedAt: null
    },
    prepare(sql) {
      return statement(this, sql);
    },
    async batch(statements) {
      batches.push(statements);
      if (statements[0]?.sql.startsWith('SELECT video.id AS videoId')) {
        return [
          { results: desiredRows },
          { results: currentRows }
        ];
      }
      return statements.map(() => ({ results: [], meta: { changes: 0 } }));
    }
  };
}

function feedStateWrites(db) {
  return db.runs.filter((item) => item.sql.includes('SET content_hash=?, row_count=?'));
}

test('feed planner returns only stale, moved, and missing rows', () => {
  const plan = planPlaybackFeedChanges(
    [{ videoId: 30 }, { videoId: 20 }, { videoId: 10 }],
    [
      { videoId: 30, rank: 1 },
      { videoId: 10, rank: 2 },
      { videoId: 40, rank: 3 }
    ]
  );

  assert.deepEqual(plan, {
    desiredCount: 3,
    stale: [{ videoId: 40 }],
    moved: [{ videoId: 10 }],
    upserts: [
      { videoId: 20, rank: 2 },
      { videoId: 10, rank: 3 }
    ]
  });
});

test('unchanged playback feed skips ranking writes and commits feed state under the lock', async () => {
  const desired = [{ videoId: 30 }, { videoId: 20 }, { videoId: 10 }];
  const current = [
    { videoId: 30, rank: 1 },
    { videoId: 20, rank: 2 },
    { videoId: 10, rank: 3 }
  ];
  const db = createFeedDb(desired, current);

  const count = await rebuildPlaybackFeed(db, '2026-07-02T00:00:00.000Z');
  const rankingWrites = db.batches.filter((batch) => batch.some((item) => (
    item.sql.startsWith('DELETE FROM ranking_entries')
    || item.sql.startsWith('UPDATE ranking_entries')
    || item.sql.startsWith('INSERT INTO ranking_entries')
  )));
  const stateWrites = feedStateWrites(db);

  assert.equal(count, 3);
  assert.equal(rankingWrites.length, 0);
  assert.equal(stateWrites.length, 1);
  assert.equal(stateWrites[0].args[1], 3);
  assert.equal(stateWrites[0].args[2], '2026-07-02T00:00:00.000Z');
  assert.equal(db.state.rowCount, 3);
  assert.equal(String(db.state.contentHash).startsWith('finalizing:'), false);
});

test('changed playback feed writes only the calculated delta and commits feed state', async () => {
  const db = createFeedDb(
    [{ videoId: 30 }, { videoId: 20 }, { videoId: 10 }],
    [
      { videoId: 30, rank: 1 },
      { videoId: 10, rank: 2 },
      { videoId: 40, rank: 3 }
    ]
  );

  const count = await rebuildPlaybackFeed(db, '2026-07-02T00:00:00.000Z');
  const writeBatch = db.batches.find((batch) => batch.some((item) => (
    item.sql.startsWith('DELETE FROM ranking_entries')
  )));
  const stateWrites = feedStateWrites(db);

  assert.equal(count, 3);
  assert.ok(writeBatch);
  assert.equal(writeBatch.length, 3);
  assert.equal(writeBatch[0].sql.startsWith('DELETE FROM ranking_entries'), true);
  assert.equal(writeBatch[1].sql.startsWith('UPDATE ranking_entries'), true);
  assert.equal(writeBatch[2].sql.startsWith('INSERT INTO ranking_entries'), true);
  assert.equal(writeBatch.some((item) => item.sql === 'DELETE FROM ranking_entries WHERE period = ?'), false);
  assert.equal(stateWrites.length, 1);
  assert.equal(stateWrites[0].args[1], 3);
  assert.equal(db.state.rowCount, 3);
});
