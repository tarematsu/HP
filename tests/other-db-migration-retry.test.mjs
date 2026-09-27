import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const provisioner = readFileSync('worker/scripts/provision-other-db.mjs', 'utf8');
const migration = readFileSync('database/other-migrations/039_official_party_materialized_metrics.sql', 'utf8');

test('OTHER_DB provisioning makes migration 039 retry-safe before later migrations run', () => {
  assert.match(migration, /ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL/);
  assert.match(provisioner, /OFFICIAL_PARTY_METRICS_MIGRATION = '039_official_party_materialized_metrics\.sql'/);
  assert.match(provisioner, /PRAGMA table_info\(\$\{tableName\}\)/);
  assert.match(provisioner, /if \(columns\.has\(name\)\) continue/);
  assert.match(provisioner, /ensureOfficialPartyMetricColumns\(\)/);
  assert.match(provisioner, /replace\(\/\^ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL/);
  assert.match(provisioner, /`--command=\$\{backfillSql\}`/);
  assert.match(provisioner, /for \(const migrationFile of activeMigrationFiles\) applyMigration\(migrationFile\)/);
});
