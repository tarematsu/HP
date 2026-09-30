import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../worker/scripts/provision-other-db.mjs', import.meta.url),
  'utf8',
);

test('OTHER_DB provisioning removes only the known obsolete host collection tables before verification', () => {
  for (const table of [
    'sh_host_raw_events',
    'sh_host_profile_snapshots',
    'sh_host_comments',
  ]) {
    assert.match(source, new RegExp(`['"]${table}['"]`));
  }

  const cleanupStart = source.indexOf('function removeObsoleteCollectionTables()');
  assert.notEqual(cleanupStart, -1);
  const cleanupCall = source.lastIndexOf('removeObsoleteCollectionTables();');
  const verifyCall = source.lastIndexOf('verifySchema();');
  assert.notEqual(cleanupCall, -1);
  assert.notEqual(verifyCall, -1);
  assert.ok(cleanupCall < verifyCall, 'retired-table cleanup must run before schema verification');

  const cleanupBody = source.slice(cleanupStart, source.indexOf('\nfunction verifySchema()', cleanupStart));
  assert.match(cleanupBody, /DROP TABLE IF EXISTS/);
  assert.match(cleanupBody, /OBSOLETE_COLLECTION_TABLES\.includes\(name\)/);
  assert.doesNotMatch(cleanupBody, /OTHER_RETIRED_OBJECTS/);
});

test('changed-only deployment remains the default path for production OTHER_DB updates', () => {
  assert.match(source, /D1_DEPLOY_CHANGED_ONLY/);
  assert.match(source, /git['"], \[\s*'diff', '--name-only'/);
  assert.match(source, /activeMigrationFiles = selectedDeploymentMigrations/);
  assert.match(source, /for \(const migrationFile of activeMigrationFiles\) applyMigration\(migrationFile\)/);
});
