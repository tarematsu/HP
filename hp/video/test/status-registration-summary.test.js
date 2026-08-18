import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  prepareRecentRegistrationsRead,
  RECENT_REGISTRATION_LIMIT
} from '../src/recent-registrations.js';
import { STATUS_COUNTS_READ, STATUS_VIDEO_COUNTS_REFRESH } from '../src/status-counts.js';

const migration = readFileSync(
  new URL('../../cloud/migrations/202608180830_video_status_registration_summary.sql', import.meta.url),
  'utf8'
);

function fakeDb() {
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

test('recent registration status query is primary-key ordered and bounded', () => {
  const statement = prepareRecentRegistrationsRead(fakeDb());
  assert.equal(RECENT_REGISTRATION_LIMIT, 10);
  assert.match(statement.sql, /FROM videos ORDER BY id DESC LIMIT \?/);
  assert.deepEqual(statement.args, [10]);
  assert.doesNotMatch(statement.sql, /COUNT\s*\(/i);
});

test('persisted status summary exposes exact total video count', () => {
  assert.match(STATUS_COUNTS_READ, /total_videos AS totalVideos/i);
  assert.doesNotMatch(STATUS_COUNTS_READ, /COUNT\s*\(/i);
  assert.match(STATUS_VIDEO_COUNTS_REFRESH, /COUNT\(\*\) AS totalVideos/i);
  assert.match(STATUS_VIDEO_COUNTS_REFRESH, /total_videos=excluded\.total_videos/i);
});

test('production migration backfills and incrementally maintains total video count', () => {
  assert.match(migration, /ADD COLUMN total_videos INTEGER NOT NULL DEFAULT 0/i);
  assert.match(migration, /total_videos=\(SELECT COUNT\(\*\) FROM videos\)/i);
  assert.match(migration, /CREATE TRIGGER status_counts_on_video_insert/i);
  assert.match(migration, /total_videos=total_videos\+1/i);
  assert.match(migration, /CREATE TRIGGER status_counts_on_video_delete/i);
  assert.match(migration, /total_videos=MAX\(0,total_videos-1\)/i);
});
