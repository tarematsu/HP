import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OTHER_REQUIRED_TABLES,
  OTHER_RETIRED_MIGRATIONS,
  OTHER_RETIRED_OBJECTS,
} from '../worker/scripts/other-db-tables.mjs';

test('OTHER_DB schema contract retains rankings and rejects duplicate metadata', () => {
  assert.ok(OTHER_REQUIRED_TABLES.includes('sh_channel_rankings'));
  assert.ok(OTHER_RETIRED_OBJECTS.includes('sh_track_metadata'));
  assert.ok(OTHER_RETIRED_OBJECTS.includes('sh_playback_channel_current'));
  assert.deepEqual(OTHER_RETIRED_MIGRATIONS, [
    '005_legacy_history_tables.sql',
    '006_legacy_snapshot_stream_count.sql',
  ]);
});

test('active ranking schema is separated from the retired legacy archive migration', () => {
  const migration = readFileSync('database/other-migrations/014_restore_channel_rankings.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_channel_rankings/);
  assert.doesNotMatch(migration, /sh_legacy_snapshots/);
});

test('remote provisioning and local smoke tests share the schema contract', () => {
  const provisioner = readFileSync('worker/scripts/provision-other-db.mjs', 'utf8');
  const smokeTest = readFileSync('site/scripts/test-local-d1.mjs', 'utf8');
  assert.match(provisioner, /from '\.\/other-db-tables\.mjs'/);
  assert.match(provisioner, /consolidateLegacyTrackMetadata\(\)/);
  assert.match(smokeTest, /OTHER_REQUIRED_TABLES/);
  assert.match(smokeTest, /migrationFiles\('database\/other-migrations'/);
});
