import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OTHER_REQUIRED_TABLES,
  OTHER_RETIRED_MIGRATIONS,
  OTHER_RETIRED_OBJECTS,
} from '../worker/scripts/other-db-tables.mjs';
import {
  metadataValuePresent,
  normalizedIsrc,
} from '../worker/scripts/track-metadata-consolidation-lib.mjs';

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

test('featured ranking reads use the channel/date/rank expression index', () => {
  const migrationPath = 'database/other-migrations/015_channel_rankings_featured_index.sql';
  const migration = readFileSync(migrationPath, 'utf8');
  const metadata = JSON.parse(readFileSync('database/other-db.json', 'utf8'));
  assert.match(
    migration,
    /ON sh_channel_rankings\(lower\(channel_name\), ranking_date, rank\)/,
  );
  assert.equal(metadata.schema, migrationPath);
});

test('remote provisioning and local smoke tests share the schema contract', () => {
  const provisioner = readFileSync('worker/scripts/provision-other-db.mjs', 'utf8');
  const smokeTest = readFileSync('site/scripts/test-local-d1.mjs', 'utf8');
  assert.match(provisioner, /from '\.\/other-db-tables\.mjs'/);
  assert.match(provisioner, /consolidateLegacyTrackMetadata\(\)/);
  assert.match(smokeTest, /OTHER_REQUIRED_TABLES/);
  assert.match(smokeTest, /migrationFiles\('database\/other-migrations'/);
});

test('metadata consolidation compares canonical ISRC values and recognizes missing text', () => {
  assert.equal(normalizedIsrc(' jp-ab c-123 '), 'JPABC123');
  assert.equal(normalizedIsrc('JPABC123'), 'JPABC123');
  assert.equal(metadataValuePresent('  '), false);
  assert.equal(metadataValuePresent(null), false);
  assert.equal(metadataValuePresent('title'), true);
});

test('database workflow tracks contracts and serializes cross-database cleanup', () => {
  const databaseWorkflow = readFileSync('.github/workflows/database.yml', 'utf8');
  assert.match(databaseWorkflow, /worker\/scripts\/other-db-tables\.mjs/);
  assert.match(databaseWorkflow, /worker\/scripts\/track-metadata-consolidation-lib\.mjs/);
  assert.match(databaseWorkflow, /other-db:\n[\s\S]*?needs: buddies-db/);
  assert.match(databaseWorkflow, /needs\.buddies-db\.result == 'success'/);
});
