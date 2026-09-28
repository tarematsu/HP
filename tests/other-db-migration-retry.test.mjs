import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const provisioner = readFileSync('worker/scripts/provision-other-db.mjs', 'utf8');
const officialPartyMigration = readFileSync(
  'database/other-migrations/039_official_party_materialized_metrics.sql',
  'utf8',
);
const spotifyCatalogMigration = readFileSync(
  'database/other-migrations/044_spotify_catalog_progress.sql',
  'utf8',
);

test('OTHER_DB provisioning makes migration 039 retry-safe before later migrations run', () => {
  assert.match(
    officialPartyMigration,
    /ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL/,
  );
  assert.match(provisioner, /OFFICIAL_PARTY_METRICS_MIGRATION = '039_official_party_materialized_metrics\.sql'/);
  assert.match(provisioner, /PRAGMA table_info\(\$\{tableName\}\)/);
  assert.match(provisioner, /if \(columns\.has\(name\)\) continue/);
  assert.match(provisioner, /ensureOfficialPartyMetricColumns\(\)/);
  assert.match(provisioner, /replace\(\/\^ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL/);
  assert.match(provisioner, /`--command=\$\{backfillSql\}`/);
  assert.match(provisioner, /for \(const migrationFile of activeMigrationFiles\) applyMigration\(migrationFile\)/);
});

test('OTHER_DB provisioning makes Spotify catalog progress migration retry-safe', () => {
  assert.match(
    spotifyCatalogMigration,
    /ADD COLUMN catalog_total INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    spotifyCatalogMigration,
    /ADD COLUMN catalog_completed INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(provisioner, /SPOTIFY_CATALOG_PROGRESS_MIGRATION = '044_spotify_catalog_progress\.sql'/);
  assert.match(provisioner, /SPOTIFY_COLLECTION_RUNS_TABLE = 'sh_spotify_collection_runs'/);
  assert.match(provisioner, /ensureSpotifyCatalogProgressColumns\(\)/);
  assert.match(provisioner, /\['catalog_total', 'INTEGER NOT NULL DEFAULT 0'\]/);
  assert.match(provisioner, /\['catalog_completed', 'INTEGER NOT NULL DEFAULT 0'\]/);
  assert.match(provisioner, /migrationFile === SPOTIFY_CATALOG_PROGRESS_MIGRATION/);
  assert.match(provisioner, /ALTER TABLE \$\{SPOTIFY_COLLECTION_RUNS_TABLE\} ADD COLUMN \$\{name\} \$\{type\}/);
});
