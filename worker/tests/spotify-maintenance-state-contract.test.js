import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/other-migrations/046_spotify_alias_bootstrap_progress.sql', import.meta.url),
  'utf8',
);
const contract = readFileSync(
  new URL('../scripts/other-db-tables.mjs', import.meta.url),
  'utf8',
);

test('Spotify alias bootstrap state is provisioned as a required OTHER_DB table', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_spotify_maintenance_state/);
  assert.match(migration, /legacy-alias-bootstrap-v1/);
  assert.match(contract, /'sh_spotify_maintenance_state'/);
});