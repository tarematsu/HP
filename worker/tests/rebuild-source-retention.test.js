import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const retention = readFileSync(new URL('../src/snapshot-retention.js', import.meta.url), 'utf8');
const retentionMigration = readFileSync(
  new URL('../../database/buddies-migrations/009_rebuild_source_retention_30d.sql', import.meta.url),
  'utf8',
);
const metadataIndexMigration = readFileSync(
  new URL('../../database/buddies-migrations/011_track_metadata_isrc_index.sql', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(readFileSync(
  new URL('../../database/buddies-db.json', import.meta.url),
  'utf8',
));
const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));

test('all durable reconstruction sources share a thirty-day retention floor', () => {
  assert.match(retention, /REBUILD_SOURCE_RETENTION_MS = 30 \* 24 \* 60 \* 60_000/);
  assert.match(retention, /MIN_RETENTION_MS = REBUILD_SOURCE_RETENTION_MS/);
  assert.match(retention, /name: 'sh_channel_snapshots'/);
  assert.match(retention, /name: 'sh_queue_snapshots'/);
  assert.match(retention, /name: 'sh_comment_minute_counts'/);
  assert.match(retention, /timeColumn: 'bucket_start'/);
  assert.equal(Object.hasOwn(runtime.vars, 'SNAPSHOT_RETENTION_MS'), false);
  assert.equal(Object.hasOwn(runtime.vars, 'SNAPSHOT_RETENTION_ENABLED'), false);
});

test('current buddies schema keeps retention safe and indexes metadata ISRC fallback', () => {
  assert.equal(manifest.schema, 'database/buddies-migrations/011_track_metadata_isrc_index.sql');
  assert.match(retentionMigration, /DROP TRIGGER IF EXISTS trg_sh_claim_retention/);
  assert.doesNotMatch(retentionMigration, /172800000/);
  assert.doesNotMatch(retentionMigration, /DELETE FROM sh_comment_minute_counts/);
  assert.match(metadataIndexMigration, /CREATE INDEX IF NOT EXISTS idx_sh_track_metadata_isrc/);
  assert.match(metadataIndexMigration, /ON sh_track_metadata\(isrc\)/);
  assert.match(metadataIndexMigration, /WHERE isrc IS NOT NULL AND TRIM\(isrc\)<>''/);
  assert.doesNotMatch(metadataIndexMigration, /INSERT|UPDATE|DELETE|ANALYZE|PRAGMA optimize/);
});
