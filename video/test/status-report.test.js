import assert from 'node:assert/strict';
import test from 'node:test';

import { readStatusReport } from '../src/status-report.js';

function statement(sql) {
  return {
    sql: sql.replace(/\s+/g, ' ').trim(),
    args: [],
    bind(...args) {
      this.args = args;
      return this;
    },
    async first() {
      return null;
    },
    async run() {
      return { meta: { changes: 0 } };
    }
  };
}

async function withFixedNow(isoTimestamp, callback) {
  const originalNow = Date.now;
  Date.now = () => Date.parse(isoTimestamp);
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

function createFakeDb() {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      return statement(sql);
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((item) => {
        if (item.sql.includes('FROM status_counts WHERE id = 1')) {
          return { results: [{
            activeVideos: 100,
            activeMp4Videos: 100,
            feedVideos: 80,
            feedMp4Videos: 80,
            blockedVideos: 3,
            deathVideos: 4,
            countsDirty: 0,
            countsUpdatedAt: '2026-07-07T02:31:00.000Z'
          }] };
        }
        if (item.sql.includes('FROM collection_runs AS runs')) {
          return { results: [{
            sourceMethod: 'manual-browser-import',
            sourceUrl: 'https://example.test/feed',
            startedAt: '2026-07-07T02:30:00.000Z',
            completedAt: '2026-07-07T02:30:01.000Z',
            foundCount: 5,
            insertedCount: 2,
            error: null,
            collectionDurationMs: 700,
            databaseDurationMs: 300,
            totalDurationMs: 1000
          }] };
        }
        if (item.sql.includes('FROM video_liveness_state WHERE id = 1')) {
          return { results: [{ phase: 'base', baseCursorId: 50, baseUpperId: 100 }] };
        }
        return { results: [], meta: { changes: 0 } };
      });
    }
  };
}

test('status summary batches persisted counts and bounded manual history', async () => {
  const DB = createFakeDb();
  const report = await withFixedNow('2026-07-07T03:01:00.000Z', () => readStatusReport({ DB }));
  const readBatch = DB.batches.find((batch) => (
    batch.length === 3 && batch[1].sql.includes('FROM collection_runs AS runs')
  ));

  assert.ok(readBatch);
  assert.match(readBatch[0].sql, /FROM status_counts WHERE id = 1/);
  assert.deepEqual(readBatch[1].args, ['manual-browser-import', 256]);
  assert.match(readBatch[2].sql, /FROM video_liveness_state WHERE id = 1/);
  assert.equal(readBatch.some((item) => item.sql.includes('ORDER BY blocked_at')), false);
  assert.equal(readBatch.some((item) => item.sql.includes('ORDER BY detected_at')), false);

  assert.equal(report.mode, 'manual-import-site-stats');
  assert.equal(report.automaticCollection, false);
  assert.deepEqual(report.schedules, {});
  assert.equal(report.counts.activeVideos, 100);
  assert.equal(report.counts.blockedVideos, 3);
  assert.equal(report.counts.deathVideos, 4);
  assert.deepEqual(report.playbackExclusions, {
    count: 3,
    type: 'manual-playback-exclusion-list',
    behavior: 'hidden-from-playback-and-skipped-during-persistence',
    publicSummaryEndpoint: '/api/status/exclusions',
    detailsEndpoint: '/api/admin/status/exclusions',
    detailsRequireAdminToken: true
  });
  assert.equal('blocklist' in report, false);
  assert.equal('items' in report.playbackExclusions, false);
  assert.equal('items' in report.deathList, false);
  assert.equal(report.deathList.count, 4);
  assert.equal(report.deathList.cursor, 50);

  assert.equal(report.latest.importedCount, 5);
  assert.equal(report.latest.insertedCount, 2);
  assert.equal(report.latest.duplicateOrExistingCount, 3);
  assert.equal(report.latestSourceRun.sourceMethod, 'manual-browser-import');
  assert.equal(report.latestSourceRun.siteKey, 'example.test');
  assert.equal(report.sites['example.test'].status, 'ok');
  assert.equal(report.sites['example.test'].insertedCount, 2);
});
