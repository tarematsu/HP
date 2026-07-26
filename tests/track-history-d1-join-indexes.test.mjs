import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../database/migrations/107_track_history_join_indexes.sql', import.meta.url),
  'utf8',
);

test('track-history evidence joins use station-first composite indexes', () => {
  assert.match(
    migration,
    /sh_queue_snapshots\(station_id, start_time, observed_at DESC, id DESC\)/,
  );
  assert.match(
    migration,
    /sh_queue_items\(station_id, start_time, observed_at DESC, position\)/,
  );
  assert.match(
    migration,
    /sh_channel_snapshots\(station_id, observed_at DESC, id DESC\)/,
  );
  assert.match(migration, /ANALYZE sh_queue_snapshots;/);
  assert.match(migration, /ANALYZE sh_queue_items;/);
  assert.match(migration, /ANALYZE sh_channel_snapshots;/);
});
