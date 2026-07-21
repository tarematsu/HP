import assert from 'node:assert/strict';
import test from 'node:test';

import {
  desiredFeedStatement,
  persistMergedFeed,
  planPlaybackFeedChanges,
  PLAYBACK_FEED_LIMIT
} from '../src/source-feed-unlimited.js';

function createStatementCaptureDb() {
  return {
    prepare(sql) {
      return {
        sql: sql.replace(/\s+/g, ' ').trim(),
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        }
      };
    }
  };
}

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

  async first() {
    if (
      this.sql.startsWith('UPDATE playback_feed_state')
      && this.sql.includes('RETURNING content_hash AS contentHash')
    ) {
      const [token, lockedAt, , staleBefore] = this.params;
      const lockActive = String(this.db.feedState.contentHash || '').startsWith('finalizing:')
        && this.db.feedState.updatedAt
        && this.db.feedState.updatedAt > staleBefore;
      if (lockActive) return null;
      this.db.feedState.contentHash = token;
      this.db.feedState.updatedAt = lockedAt;
      this.db.feedState.version += 1;
      return { contentHash: token };
    }
    if (this.sql.startsWith('SELECT content_hash AS contentHash')) {
      return { ...this.db.feedState };
    }
    return null;
  }

  async run() {
    if (/INSERT INTO collection_runs/.test(this.sql)) {
      return { meta: { last_row_id: 7, changes: 1 } };
    }

    if (this.sql.includes('AND version=?')) {
      const [token, lockedAt, expectedVersion] = this.params;
      if (
        this.db.feedState.version !== expectedVersion
        || String(this.db.feedState.contentHash || '').startsWith('finalizing:')
      ) {
        return { meta: { changes: 0 } };
      }
      this.db.feedState.contentHash = token;
      this.db.feedState.updatedAt = lockedAt;
      this.db.feedState.version += 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes('SET content_hash=?, row_count=?')) {
      const [contentHash, rowCount, updatedAt, token] = this.params;
      if (this.db.feedState.contentHash !== token) return { meta: { changes: 0 } };
      this.db.feedState.contentHash = contentHash;
      this.db.feedState.rowCount = rowCount;
      this.db.feedState.updatedAt = updatedAt;
      this.db.feedState.version += 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes('SET content_hash=NULL')) {
      const [updatedAt, token] = this.params;
      if (this.db.feedState.contentHash !== token) return { meta: { changes: 0 } };
      this.db.feedState.contentHash = null;
      this.db.feedState.updatedAt = updatedAt;
      this.db.feedState.version += 1;
      return { meta: { changes: 1 } };
    }

    return { success: true, meta: { changes: 0 } };
  }
}

class PersistFailureDb {
  constructor() {
    this.completedRuns = [];
    this.feedState = { contentHash: null, rowCount: 0, version: 0, updatedAt: null };
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    if (statements.some((statement) => /SELECT video\.id AS videoId/.test(statement.sql))) {
      throw new Error('simulated playback feed sync failure');
    }
    if (statements.some((statement) => /UPDATE collection_runs SET completed_at/.test(statement.sql))) {
      const update = statements.find((statement) => /UPDATE collection_runs SET completed_at/.test(statement.sql));
      this.completedRuns.push({
        foundCount: update.params[1],
        insertedCount: update.params[2],
        error: update.params[3]
      });
    }
    return statements.map((statement) => {
      if (/^WITH incoming AS/.test(statement.sql)) {
        return { results: [{ inserted: 1 }], meta: { changes: 1 } };
      }
      return { success: true, results: [], meta: { changes: 0 } };
    });
  }
}

class AbortDuringFinishDb {
  constructor(controller) {
    this.controller = controller;
    this.correctedError = null;
  }

  prepare(sql) {
    const db = this;
    return {
      sql: sql.replace(/\s+/g, ' ').trim(),
      params: [],
      bind(...params) {
        this.params = params;
        return this;
      },
      async run() {
        if (/UPDATE collection_runs SET error = \? WHERE id = \?/.test(this.sql)) {
          db.correctedError = this.params[0];
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }

  async batch(statements) {
    if (statements.some((statement) => /UPDATE collection_runs SET completed_at/.test(statement.sql))) {
      this.controller.abort(new Error('simulated collection timeout'));
    }
    return statements.map((statement) => {
      if (/^WITH incoming AS/.test(statement.sql)) {
        return { results: [{ inserted: 1 }], meta: { changes: 1 } };
      }
      return { success: true, results: [], meta: { changes: 1 } };
    });
  }
}

test('desired playback feed excludes manually and automatically excluded videos', () => {
  const statement = desiredFeedStatement(createStatementCaptureDb(), '2026-07-02T00:00:00.000Z');

  assert.match(statement.sql, /FROM videos AS video/);
  assert.match(statement.sql, /video\.status = 'active'/);
  assert.match(statement.sql, /video_blocklist AS bad/);
  assert.match(statement.sql, /video_death_list AS death/);
  assert.match(statement.sql, /bad\.canonical_key = video\.canonical_key/);
  assert.match(statement.sql, /death\.canonical_key = video\.canonical_key/);
  assert.equal(statement.args[1], PLAYBACK_FEED_LIMIT);
});

test('playback feed planner removes current entries no longer desired', () => {
  const plan = planPlaybackFeedChanges(
    [{ videoId: 12 }, { videoId: 12 }, { videoId: 15 }],
    [{ videoId: 12, rank: 1 }, { videoId: 99, rank: 2 }]
  );

  assert.equal(plan.desiredCount, 2);
  assert.deepEqual(plan.stale, [{ videoId: 99 }]);
  assert.deepEqual(plan.upserts, [{ videoId: 15, rank: 2 }]);
});

test('collection run keeps inserted count when playback feed sync fails after saving videos', async () => {
  const db = new PersistFailureDb();
  await assert.rejects(
    persistMergedFeed(
      { DB: db },
      {
        method: 'test',
        sourceUrl: 'https://example.invalid/feed',
        urls: ['https://cdn.example/ext_media/123/pu/vid/720x1280/a.mp4?tag=12']
      }
    ),
    /simulated playback feed sync failure/
  );

  const lastRun = db.completedRuns.at(-1);
  assert.equal(lastRun.foundCount, 1);
  assert.equal(lastRun.insertedCount, 1);
  assert.match(lastRun.error, /playback feed sync failure/);
  assert.equal(db.feedState.contentHash, null);
});

test('collection timeout during success recording is corrected back to failure', async () => {
  const controller = new AbortController();
  const db = new AbortDuringFinishDb(controller);
  const startedMs = Date.now();

  await assert.rejects(
    persistMergedFeed(
      { DB: db },
      {
        run: {
          runId: 7,
          startedMs,
          collectionStartedMs: startedMs,
          initialDatabaseDurationMs: 0
        },
        signal: controller.signal,
        method: 'test',
        sourceUrl: 'https://example.invalid/feed',
        deferFeedMaintenance: true,
        urls: ['https://cdn.example/ext_media/456/pu/vid/720x1280/b.mp4?tag=12']
      }
    ),
    /simulated collection timeout/
  );

  assert.match(db.correctedError, /simulated collection timeout/);
});
