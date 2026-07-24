import assert from 'node:assert/strict';
import test from 'node:test';

import { feedContentHash } from '../src/d1-compaction.js';
import { synchronizeCompactedFeed } from '../src/source-feed-compacted.js';
import { rebuildPlaybackFeed } from '../src/source-feed-unlimited.js';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async all() {
    if (this.sql.startsWith('SELECT video.id AS videoId')) {
      this.db.desiredReads += 1;
      return { results: this.db.desiredRows };
    }
    if (this.sql.startsWith('SELECT video_id AS videoId')) {
      this.db.currentReads += 1;
      return { results: this.db.currentRows };
    }
    return { results: [] };
  }

  async first() {
    if (
      this.sql.startsWith('UPDATE playback_feed_state')
      && this.sql.includes('RETURNING content_hash AS contentHash')
    ) {
      const [token, lockedAt, , staleBefore] = this.args;
      const lockActive = String(this.db.state.contentHash || '').startsWith('finalizing:')
        && this.db.state.updatedAt
        && this.db.state.updatedAt > staleBefore;
      if (lockActive) return null;
      this.db.state.contentHash = token;
      this.db.state.updatedAt = lockedAt;
      this.db.state.version += 1;
      return { contentHash: token };
    }
    if (this.sql.startsWith('SELECT content_hash AS contentHash')) {
      return { ...this.db.state };
    }
    return null;
  }

  async run() {
    if (this.sql.includes('AND version=?')) {
      const [token, lockedAt, expectedVersion] = this.args;
      if (
        this.db.state.version !== expectedVersion
        || String(this.db.state.contentHash || '').startsWith('finalizing:')
      ) {
        return { meta: { changes: 0 } };
      }
      this.db.state.contentHash = token;
      this.db.state.updatedAt = lockedAt;
      this.db.state.version += 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes('SET content_hash=?, row_count=?')) {
      const [contentHash, rowCount, updatedAt, token] = this.args;
      if (this.db.state.contentHash !== token) return { meta: { changes: 0 } };
      this.db.stateWrites += 1;
      this.db.state = {
        contentHash,
        rowCount,
        updatedAt,
        version: this.db.state.version + 1
      };
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes('SET content_hash=NULL')) {
      const [updatedAt, token] = this.args;
      if (this.db.state.contentHash !== token) return { meta: { changes: 0 } };
      this.db.state.contentHash = null;
      this.db.state.updatedAt = updatedAt;
      this.db.state.version += 1;
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 1, last_row_id: 1 } };
  }
}

class FeedDb {
  constructor(desiredRows, currentRows) {
    this.desiredRows = desiredRows;
    this.currentRows = currentRows;
    this.state = { contentHash: null, rowCount: 0, version: 0, updatedAt: null };
    this.desiredReads = 0;
    this.currentReads = 0;
    this.stateWrites = 0;
    this.rankingWriteBatches = 0;
    this.sqlSyncBatches = 0;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    const sqlSync = statements.length === 4
      && statements[0].sql.startsWith('WITH desired AS')
      && statements[3].sql.startsWith('SELECT COUNT(*) AS rowCount');
    if (sqlSync) {
      this.sqlSyncBatches += 1;
      return [
        { results: [], meta: { changes: 0 } },
        { results: [], meta: { changes: 0 } },
        { results: [], meta: { changes: 0 } },
        {
          results: [{
            rowCount: this.desiredRows.length,
            contentJson: JSON.stringify(this.desiredRows.map((row) => String(row.videoId)))
          }],
          meta: { changes: 0 }
        }
      ];
    }

    if (statements.some((statement) => statement.sql.startsWith('DELETE FROM ranking_entries')
      || statement.sql.startsWith('UPDATE ranking_entries')
      || statement.sql.startsWith('INSERT INTO ranking_entries'))) {
      this.rankingWriteBatches += 1;
    }
    return statements.map((statement) => {
      if (statement.sql.startsWith('SELECT video.id AS videoId')) {
        this.desiredReads += 1;
        return { results: this.desiredRows, meta: { changes: 0 } };
      }
      if (statement.sql.startsWith('SELECT video_id AS videoId')) {
        this.currentReads += 1;
        return { results: this.currentRows, meta: { changes: 0 } };
      }
      return { results: [], meta: { changes: 0 } };
    });
  }
}

test('both playback feed rebuild paths commit a consistent state under the shared lock', async () => {
  const desiredRows = [{ videoId: 1 }, { videoId: 2 }];
  const db = new FeedDb(desiredRows, [
    { videoId: 1, rank: 1 },
    { videoId: 2, rank: 2 }
  ]);
  const capturedAt = '2026-07-05T00:00:00.000Z';

  assert.equal(await rebuildPlaybackFeed(db, capturedAt), 2);
  assert.equal(db.desiredReads, 1);
  assert.equal(db.currentReads, 1);
  assert.equal(db.rankingWriteBatches, 0);
  assert.equal(db.stateWrites, 1);
  assert.equal(db.state.rowCount, 2);
  assert.equal(db.state.contentHash, await feedContentHash(desiredRows));

  assert.equal(await synchronizeCompactedFeed(db, capturedAt), 2);
  assert.equal(db.desiredReads, 1);
  assert.equal(db.currentReads, 1);
  assert.equal(db.sqlSyncBatches, 1);
  assert.equal(db.stateWrites, 2);
  assert.equal(db.state.rowCount, 2);
  assert.equal(db.state.contentHash, await feedContentHash(desiredRows));
});
