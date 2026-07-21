import assert from 'node:assert/strict';
import test from 'node:test';

import { persistMergedFeed } from '../src/source-feed-unlimited.js';

function createStatement(sql) {
  return {
    sql: sql.replace(/\s+/g, ' ').trim(),
    bind(...args) {
      this.args = args;
      return this;
    }
  };
}

function createDb() {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      return createStatement(sql);
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((item) => {
        if (item.sql.startsWith('WITH incoming AS')) {
          return { results: [{ inserted: 1 }, { inserted: 0 }], meta: { changes: 2 } };
        }
        return { results: [], meta: { changes: 0 } };
      });
    }
  };
}

test('persistence gets inserted counts from the UPSERT without an existence SELECT', async () => {
  const DB = createDb();
  const now = Date.now();
  const result = await persistMergedFeed({ DB }, {
    run: {
      runId: 7,
      startedMs: now,
      collectionStartedMs: now,
      initialDatabaseDurationMs: 0
    },
    method: 'test-source',
    sourceUrl: 'https://example.invalid/source',
    deferFeedMaintenance: true,
    urls: [
      'https://cdn.example/a.mp4',
      'https://cdn.example/b.mp4'
    ]
  });

  const saveBatch = DB.batches.find((batch) => (
    batch.some((item) => item.sql.startsWith('WITH incoming AS'))
  ));
  assert.ok(saveBatch);
  assert.equal(saveBatch.length, 1);
  assert.equal(saveBatch[0].sql.includes('SELECT COUNT(*)'), false);
  assert.equal(saveBatch[0].sql.includes('INSERT INTO videos'), true);
  assert.equal(saveBatch[0].sql.includes('ON CONFLICT(canonical_key) DO UPDATE'), true);
  assert.equal(saveBatch[0].sql.includes('RETURNING CASE'), true);
  assert.equal(result.inserted, 1);
  assert.equal(result.duplicatesOrExisting, 1);
});
