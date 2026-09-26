import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const descriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));
const migration = readFileSync(
  new URL('../database/facts-migrations/056_stream_minute_delta_read_model.sql', import.meta.url),
  'utf8',
);
const dashboard = readFileSync(
  new URL('../site/functions/lib/dashboard-chart-support.js', import.meta.url),
  'utf8',
);

test('stream minute delta read model is the current MINUTE_DB schema tip', () => {
  const path = 'database/facts-migrations/056_stream_minute_delta_read_model.sql';
  assert.equal(descriptor.schema, path);
  assert.equal(descriptor.migrations.at(-1), path);
  assert.equal(descriptor.migrations.filter((value) => value === path).length, 1);
});

test('stream minute deltas are materialized and repair their dependent next minute', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_stream_minute_delta_read_model/);
  assert.match(migration, /PRIMARY KEY\(channel_id, minute_at\)/);
  assert.match(migration, /WITHOUT ROWID/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS trg_sh_stream_minute_delta_after_insert/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS trg_sh_stream_minute_delta_after_update/);
  assert.match(migration, /f\.minute_at-p\.minute_at=60000/);
  assert.match(migration, /f\.reported_current_stream_count>=p\.reported_current_stream_count/);
  assert.match(migration, /f\.minute_at IN \(NEW\.minute_at,NEW\.minute_at\+60000\)/);
  assert.match(migration, /ELSE NULL/);
});

test('deployment seed is bounded and Pages reads only the materialized delta table', () => {
  assert.match(migration, /unixepoch\('now','-26 hours'\)\*1000/);
  assert.doesNotMatch(migration, /DELETE FROM sh_minute_facts/);
  assert.match(dashboard, /FROM sh_stream_minute_delta_read_model AS d/);
  assert.doesNotMatch(dashboard, /FROM sh_minute_facts/);
  assert.doesNotMatch(dashboard, /reported_current_stream_count/);
});
