import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { directFiveMinuteStreamHistory } from '../site/functions/lib/dashboard-chart-support.js';

const descriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));
const migration = readFileSync(
  new URL('../database/facts-migrations/065_direct_5m_stream_history.sql', import.meta.url),
  'utf8',
);
const dashboard = readFileSync(
  new URL('../site/functions/lib/dashboard-chart-support.js', import.meta.url),
  'utf8',
);

test('direct five-minute stream migration remains installed before the current MINUTE_DB schema tip', () => {
  const path = 'database/facts-migrations/065_direct_5m_stream_history.sql';
  assert.equal(descriptor.schema, descriptor.migrations.at(-1));
  assert.equal(descriptor.migrations.filter((value) => value === path).length, 1);
  assert.ok(descriptor.migrations.indexOf(path) < descriptor.migrations.indexOf(descriptor.schema));
});

test('legacy minute-average triggers and table are retired', () => {
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_boundary_insert/);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_late_insert/);
  assert.match(migration, /DROP TABLE IF EXISTS sh_stream_5m_average_read_model/);
});

test('five-minute playback values use a rolling 15-minute average normalized back to five minutes', () => {
  const base = Date.UTC(2026, 8, 30, 0, 0, 0);
  assert.deepEqual(directFiveMinuteStreamHistory([
    { observed_at: base, current_stream_count: 100 },
    { observed_at: base + 5 * 60_000, current_stream_count: 112 },
    { observed_at: base + 10 * 60_000, current_stream_count: 127 },
    { observed_at: base + 15 * 60_000, current_stream_count: 145 },
    { observed_at: base + 20 * 60_000, current_stream_count: 160 },
  ]), [
    { observed_at: base + 15 * 60_000, stream_delta: 15, sample_count: 3 },
    { observed_at: base + 20 * 60_000, stream_delta: 16, sample_count: 3 },
  ]);
});

test('Pages derives playback counts from dashboard history without average-table reads', () => {
  assert.match(dashboard, /FROM sh_dashboard_history_5m AS r/);
  assert.match(dashboard, /current_stream_count/);
  assert.match(dashboard, /directFiveMinuteStreamHistory/);
  assert.doesNotMatch(dashboard, /sh_stream_5m_average_read_model/);
  assert.doesNotMatch(dashboard, /AVG\(|GROUP BY/);
});
