import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pruneOldSnapshots,
  pruneOldSnapshotsSafely,
  REBUILD_SOURCE_RETENTION_MS,
  shouldRunSnapshotRetention,
  snapshotRetentionEnabled,
} from '../src/snapshot-retention.js';

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;
const RETENTION_INDEXES = [
  'idx_sh_channel_snapshots_observed_id',
  'idx_sh_queue_snapshots_time',
  'idx_sh_comment_minute_counts_bucket',
  'idx_sh_queue_items_observed',
  'idx_sh_track_like_observations_time',
  'idx_sh_track_metadata_fetched_at',
  'idx_sh_ingest_claims_observed',
  'idx_sh_ingest_conflicts_observed',
];

class FakeBuddiesDb {
  constructor({
    lastCleanupAt = 0,
    snapshots = [],
    auxiliaryDeleteChanges = [],
    indexNames = RETENTION_INDEXES,
  } = {}) {
    this.lastCleanupAt = lastCleanupAt;
    this.snapshots = snapshots.map((row) => ({ ...row }));
    this.auxiliaryDeleteChanges = [...auxiliaryDeleteChanges];
    this.indexNames = [...indexNames];
    this.calls = [];
    this.batchCalls = [];
  }

  statement(sql, values = []) {
    return {
      first: async () => (sql.includes('last_cleanup_at') ? { last_cleanup_at: this.lastCleanupAt } : null),
      all: async () => {
        if (sql.includes('sqlite_schema')) {
          return { results: this.indexNames.map((name) => ({ name })) };
        }
        if (sql.includes('SELECT id,channel_id,observed_at') && sql.includes('FROM sh_channel_snapshots')) {
          const [cutoff, limit] = values;
          return {
            results: this.snapshots
              .filter((row) => row.observed_at < cutoff)
              .sort((left, right) => left.observed_at - right.observed_at || left.id - right.id)
              .slice(0, limit),
          };
        }
        return { results: [] };
      },
      run: async () => {
        if (sql.startsWith('DELETE FROM sh_channel_snapshots WHERE id IN (')) {
          const ids = new Set((sql.match(/\(([^)]+)\)/)?.[1] || '')
            .split(',').map((value) => Number(value)).filter(Number.isFinite));
          const before = this.snapshots.length;
          this.snapshots = this.snapshots.filter((row) => !ids.has(row.id));
          return { meta: { changes: before - this.snapshots.length } };
        }
        if (sql.startsWith('DELETE FROM')) {
          return { meta: { changes: this.auxiliaryDeleteChanges.shift() ?? 0 } };
        }
        return { meta: { changes: 1 } };
      },
      values,
    };
  }

  prepare(sql) {
    this.calls.push(sql);
    return {
      bind: (...values) => this.statement(sql, values),
      run: async () => this.statement(sql).run(),
    };
  }

  async batch(statements) {
    this.batchCalls.push(statements.length);
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class FakeMinuteDb {
  constructor(facts = []) {
    this.facts = facts;
    this.calls = [];
  }

  prepare(sql) {
    this.calls.push(sql);
    return {
      bind: (start, end) => ({
        all: async () => ({
          results: this.facts.filter((row) => row.minute_at >= start && row.minute_at < end),
        }),
      }),
    };
  }
}

function minute(value) {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

test('snapshotRetentionEnabled defaults to true and honors explicit disable', () => {
  assert.equal(snapshotRetentionEnabled({}), true);
  assert.equal(snapshotRetentionEnabled({ SNAPSHOT_RETENTION_ENABLED: 'false' }), false);
});

test('shouldRunSnapshotRetention preserves the interval calculation', () => {
  assert.equal(shouldRunSnapshotRetention(0, 3_600_000, {}), true);
  assert.equal(shouldRunSnapshotRetention(3_500_000, 3_600_000, {}), false);
});

test('retention deletes channel snapshots only after the matching minute fact exists', async () => {
  const now = 4_000_000_000;
  const cutoff = now - REBUILD_SOURCE_RETENTION_MS;
  const materializedAt = cutoff - 10 * MINUTE_MS;
  const protectedAt = cutoff - 9 * MINUTE_MS;
  const recentAt = cutoff + MINUTE_MS;
  const db = new FakeBuddiesDb({
    snapshots: [
      { id: 1, channel_id: 318, observed_at: materializedAt },
      { id: 2, channel_id: 318, observed_at: protectedAt },
      { id: 3, channel_id: 318, observed_at: recentAt },
    ],
    auxiliaryDeleteChanges: [2, 0, 0, 0, 0, 0, 0],
  });
  const minuteDb = new FakeMinuteDb([
    { channel_id: 318, minute_at: minute(materializedAt) },
  ]);

  const result = await pruneOldSnapshots({
    BUDDIES_DB: db,
    MINUTE_DB: minuteDb,
    SNAPSHOT_RETENTION_MS: DAY_MS,
    SNAPSHOT_RETENTION_BATCH_SIZE: 1000,
    SNAPSHOT_RETENTION_MAX_BATCHES: 1,
  }, now);

  assert.equal(REBUILD_SOURCE_RETENTION_MS, 30 * DAY_MS);
  assert.equal(result.cutoff, cutoff);
  assert.equal(result.deleted.sh_channel_snapshots, 1);
  assert.equal(result.deleted.sh_queue_snapshots, 2);
  assert.deepEqual(result.channel_snapshots, {
    scanned: 2,
    protected_unmaterialized: 1,
  });
  assert.deepEqual(db.snapshots.map((row) => row.id), [2, 3]);
  assert.equal(minuteDb.calls.length, 1);
  assert.deepEqual(db.batchCalls, [7]);
});

test('retention keeps old channel snapshots when minute facts are unavailable', async () => {
  const now = 4_000_000_000;
  const cutoff = now - REBUILD_SOURCE_RETENTION_MS;
  const db = new FakeBuddiesDb({
    snapshots: [{ id: 1, channel_id: 318, observed_at: cutoff - MINUTE_MS }],
  });

  const result = await pruneOldSnapshots({
    BUDDIES_DB: db,
    SNAPSHOT_RETENTION_BATCH_SIZE: 100,
    SNAPSHOT_RETENTION_MAX_BATCHES: 1,
  }, now);

  assert.equal(result.deleted.sh_channel_snapshots, 0);
  assert.equal(result.channel_snapshots.protected_unmaterialized, 1);
  assert.deepEqual(db.snapshots.map((row) => row.id), [1]);
});

test('retention can remove corrected old source snapshots without requiring source-record equality', async () => {
  const now = 4_000_000_000;
  const cutoff = now - REBUILD_SOURCE_RETENTION_MS;
  const observedAt = cutoff - MINUTE_MS;
  const db = new FakeBuddiesDb({
    snapshots: [{ id: 99, channel_id: 318, observed_at: observedAt }],
  });
  const minuteDb = new FakeMinuteDb([
    { channel_id: 318, minute_at: minute(observedAt), source_record_id: 'manual-correction' },
  ]);

  const result = await pruneOldSnapshots({
    BUDDIES_DB: db,
    MINUTE_DB: minuteDb,
    SNAPSHOT_RETENTION_BATCH_SIZE: 100,
    SNAPSHOT_RETENTION_MAX_BATCHES: 1,
  }, now);

  assert.equal(result.deleted.sh_channel_snapshots, 1);
  assert.deepEqual(db.snapshots, []);
});

test('retention refuses to scan when a required timestamp index is missing', async () => {
  const db = new FakeBuddiesDb({
    indexNames: RETENTION_INDEXES.filter((name) => name !== 'idx_sh_queue_items_observed'),
  });
  assert.deepEqual(
    await pruneOldSnapshots({ BUDDIES_DB: db }, 4_000_000_000),
    {
      skipped: true,
      reason: 'retention-indexes-missing',
      missing_indexes: ['idx_sh_queue_items_observed'],
    },
  );
  assert.equal(db.calls.filter((sql) => sql.startsWith('DELETE FROM')).length, 0);
  assert.deepEqual(db.batchCalls, []);
});

test('retention observes the cleanup interval', async () => {
  const db = new FakeBuddiesDb({ lastCleanupAt: 97_000_000 });
  assert.deepEqual(
    await pruneOldSnapshots({ BUDDIES_DB: db }, 100_000_000),
    { skipped: true, reason: 'not-due' },
  );
  assert.equal(db.calls.filter((sql) => sql.startsWith('DELETE FROM')).length, 0);
  assert.deepEqual(db.batchCalls, []);
});

test('missing binding is reported safely', async () => {
  assert.deepEqual(
    await pruneOldSnapshotsSafely({}, 100_000_000),
    { skipped: true, reason: 'db-binding-missing' },
  );
});

test('explicit retention disable remains distinguishable', async () => {
  assert.deepEqual(
    await pruneOldSnapshots({ SNAPSHOT_RETENTION_ENABLED: '0' }),
    { skipped: true, reason: 'disabled' },
  );
});
