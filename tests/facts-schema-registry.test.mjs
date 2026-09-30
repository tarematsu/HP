import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const descriptor = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'database/facts-db.json'),
  'utf8',
));
const migrationsDir = resolve(repositoryRoot, 'database/facts-migrations');

function ordinal(name) {
  const match = String(name || '').match(/^(\d+)_.*\.sql$/);
  return match ? Number(match[1]) : -1;
}

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => ordinal(name) >= 0)
  .sort((left, right) => ordinal(left) - ordinal(right) || left.localeCompare(right));
const latestPath = `database/facts-migrations/${migrationFiles.at(-1)}`;

test('MINUTE_DB descriptor points at the newest numbered migration', () => {
  assert.equal(descriptor.schema, latestPath);
  assert.equal(descriptor.migrations.at(-1), latestPath);
});

test('every configured MINUTE_DB migration exists on disk', () => {
  for (const migration of descriptor.migrations) {
    assert.ok(
      migrationFiles.includes(basename(migration)),
      `configured migration is missing: ${migration}`,
    );
  }
});
