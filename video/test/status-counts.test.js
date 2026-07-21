import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { needsStatusCountRefresh } from '../src/status-report.js';
import {
  refreshStatusCounts,
  STATUS_COUNTS_CLEAR_DIRTY,
  STATUS_COUNTS_READ,
  STATUS_EXCLUSION_COUNTS_REFRESH,
  STATUS_VIDEO_COUNTS_REFRESH
} from '../src/status-counts.js';

const dirtyMigration = readFileSync(
  new URL('../migrations/902_status_counts_dirty.sql', import.meta.url),
  'utf8'
);
const livenessDeltaMigration = readFileSync(
  new URL('../migrations/100002_liveness_status_count_deltas.sql', import.meta.url),
  'utf8'
);
const blockDeltaMigration = readFileSync(
  new URL('../migrations/100003_block_status_count_delta.sql', import.meta.url),
  'utf8'
);

test('status requests read only the persisted singleton summary', () => {
  assert.match(STATUS_COUNTS_READ, /FROM status_counts WHERE id = 1/i);
  assert.match(STATUS_COUNTS_READ, /dirty AS countsDirty/i);
  assert.doesNotMatch(STATUS_COUNTS_READ, /COUNT\s*\(/i);
  assert.doesNotMatch(STATUS_COUNTS_READ, /CREATE TABLE/i);
  assert.doesNotMatch(STATUS_COUNTS_READ, /JOIN\s+videos/i);
});

test('video and exclusion counts refresh independently without clearing dirty state', () => {
  assert.match(STATUS_VIDEO_COUNTS_REFRESH, /FROM videos/i);
  assert.match(STATUS_VIDEO_COUNTS_REFRESH, /ranking_entries/i);
  assert.doesNotMatch(STATUS_VIDEO_COUNTS_REFRESH, /video_blocklist/i);
  assert.doesNotMatch(STATUS_VIDEO_COUNTS_REFRESH, /video_death_list/i);
  assert.doesNotMatch(STATUS_VIDEO_COUNTS_REFRESH, /dirty\s*=\s*0/i);

  assert.match(STATUS_EXCLUSION_COUNTS_REFRESH, /video_blocklist/i);
  assert.match(STATUS_EXCLUSION_COUNTS_REFRESH, /video_death_list/i);
  assert.doesNotMatch(STATUS_EXCLUSION_COUNTS_REFRESH, /ranking_entries/i);
  assert.doesNotMatch(STATUS_EXCLUSION_COUNTS_REFRESH, /dirty\s*=\s*0/i);
});

test('only a complete refresh clears and returns the persistent dirty marker', () => {
  assert.match(STATUS_COUNTS_CLEAR_DIRTY, /SET dirty = 0/i);
  assert.match(STATUS_COUNTS_CLEAR_DIRTY, /RETURNING[\s\S]*dirty AS countsDirty/i);
});

test('complete refresh scans and clears dirty state in one D1 batch', async () => {
  let batchStatements = null;
  const refreshed = {
    activeVideos: 10,
    feedVideos: 8,
    deathVideos: 2,
    countsDirty: 0,
    countsUpdatedAt: '2026-07-05T12:00:00.000Z'
  };
  const db = {
    prepare(sql) {
      return {
        sql: sql.replace(/\s+/g, ' ').trim(),
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          throw new Error('atomic refresh should return its row from batch');
        },
        async run() {
          throw new Error('full refresh must use batch');
        }
      };
    },
    async batch(statements) {
      batchStatements = statements;
      return [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { results: [refreshed], meta: { changes: 1 } }
      ];
    }
  };

  const row = await refreshStatusCounts(db, '2026-07-05T12:00:00.000Z');
  assert.equal(batchStatements.length, 3);
  assert.match(batchStatements[0].sql, /FROM videos/i);
  assert.match(batchStatements[1].sql, /FROM video_blocklist/i);
  assert.match(batchStatements[2].sql, /SET dirty = 0/i);
  assert.deepEqual(row, refreshed);
});

test('dirty state survives until a complete fallback refresh', () => {
  assert.equal(needsStatusCountRefresh({}), true);
  assert.equal(needsStatusCountRefresh({
    countsUpdatedAt: '2026-07-05T10:00:00.000Z',
    countsDirty: 1
  }), true);
  assert.equal(needsStatusCountRefresh({
    countsUpdatedAt: '2026-07-05T10:00:00.000Z',
    countsDirty: 0
  }), false);
});

test('transactional liveness retires death dirty triggers', () => {
  assert.match(dirtyMigration, /AFTER INSERT ON video_death_list/i);
  assert.match(dirtyMigration, /AFTER DELETE ON video_death_list/i);
  assert.match(livenessDeltaMigration, /DROP TRIGGER IF EXISTS status_counts_dirty_on_death_insert/i);
  assert.match(livenessDeltaMigration, /DROP TRIGGER IF EXISTS status_counts_dirty_on_death_delete/i);
  assert.doesNotMatch(livenessDeltaMigration, /DROP TRIGGER[^;]*status_counts_dirty_on_block/i);
  assert.match(livenessDeltaMigration, /UPDATE status_counts[\s\S]*SET dirty = 1/i);
});

test('block insert uses an incremental trigger while block delete keeps dirty fallback', () => {
  assert.match(dirtyMigration, /AFTER INSERT ON video_blocklist/i);
  assert.match(dirtyMigration, /AFTER DELETE ON video_blocklist/i);
  assert.match(blockDeltaMigration, /DROP TRIGGER IF EXISTS status_counts_dirty_on_block_insert/i);
  assert.match(blockDeltaMigration, /CREATE TRIGGER IF NOT EXISTS status_counts_delta_on_block_insert/i);
  assert.match(blockDeltaMigration, /AFTER INSERT ON video_blocklist/i);
  assert.match(blockDeltaMigration, /active_videos = MAX\(0, active_videos - EXISTS/i);
  assert.match(blockDeltaMigration, /feed_videos = MAX\(0, feed_videos - EXISTS/i);
  assert.match(blockDeltaMigration, /blocked_videos = blocked_videos \+ 1/i);
  assert.doesNotMatch(blockDeltaMigration, /DROP TRIGGER[^;]*status_counts_dirty_on_block_delete/i);
  assert.match(blockDeltaMigration, /UPDATE status_counts[\s\S]*SET dirty = 1/i);
});
