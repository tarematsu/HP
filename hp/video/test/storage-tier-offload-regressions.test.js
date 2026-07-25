import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PLAYBACK_FEED_LIMIT } from '../src/feed-limits.js';
import { desiredFeedItemsStatement } from '../src/playback-feed-sync.js';
import { upsertVideoItemsStatement } from '../src/video-storage-statements.js';

function captureDb() {
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

test('source collection preserves dead status and liveness failure state', () => {
  const statement = upsertVideoItemsStatement(
    captureDb(),
    JSON.stringify([{ key: 'dead-key', url: 'https://cdn.example/dead.mp4', type: 'mp4' }]),
    '2026-07-25T00:00:00.000Z',
    { conditional: true, returningInserted: true }
  );

  assert.match(statement.sql, /videos\.status IN \('hidden','dead'\)/);
  assert.match(statement.sql, /videos\.status = 'dead' THEN videos\.fail_count/);
  assert.doesNotMatch(statement.sql, /videos\.status NOT IN \('active','hidden'\)$/);
});

test('candidate feed excludes blocklisted and dead videos before applying the final limit', () => {
  const statement = desiredFeedItemsStatement(captureDb(), [
    { key: 'one' },
    { key: 'two' }
  ]);

  assert.match(statement.sql, /video_blocklist AS blocked/);
  assert.match(statement.sql, /video_death_list AS dead/);
  assert.match(statement.sql, /ORDER BY rank LIMIT \?/);
  assert.equal(statement.args.at(-1), PLAYBACK_FEED_LIMIT);
});

test('video URL changes keep the death-list probe target current', () => {
  const migration = readFileSync(
    new URL('../../cloud/migrations/202607240400_storage_tier_offload.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /CREATE TRIGGER sync_video_death_list_media_url/);
  assert.match(migration, /AFTER UPDATE OF media_url ON videos/);
  assert.match(migration, /UPDATE video_death_list[\s\S]*SET media_url = NEW\.media_url/);
});
