import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../site/functions/lib/current-minute-summary.js';
import { RECENT_DAILY_PROJECTION_SQL } from '../worker/src/recent-daily-summary-publication.js';

const descriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));
const migration = readFileSync(
  new URL('../database/facts-migrations/060_canonical_daily_member_ownership.sql', import.meta.url),
  'utf8',
);

function triggerBody(name, nextName) {
  const start = migration.indexOf(`CREATE TRIGGER ${name}`);
  assert.notEqual(start, -1, name);
  const end = nextName
    ? migration.indexOf(`CREATE TRIGGER ${nextName}`, start + 1)
    : migration.indexOf('\nANALYZE sh_current_daily_summary', start + 1);
  assert.notEqual(end, -1, `${name} end`);
  return migration.slice(start, end);
}

test('member boundaries have one canonical compact owner', () => {
  const path = 'database/facts-migrations/060_canonical_daily_member_ownership.sql';
  assert.equal(descriptor.schema, descriptor.migrations.at(-1));
  assert.equal(descriptor.migrations.filter((value) => value === path).length, 1);
  assert.ok(descriptor.migrations.indexOf(path) < descriptor.migrations.length);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /FROM sh_total_member_daily/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /p\.member_end/);
  assert.doesNotMatch(RECENT_DAILY_PROJECTION_SQL, /member_end/);
});

test('current daily projection retires duplicated member storage while retaining metric batching', () => {
  assert.match(migration, /SET member_end_at=NULL,member_end=NULL/);
  assert.match(migration, /NEW\.minute_at%300000=0/);
  assert.match(migration, /trg_sh_current_daily_summary_late_insert/);
  assert.match(migration, /AFTER UPDATE OF listener_count,reported_current_stream_count,observed_at,received_at/);

  const fiveMinute = triggerBody(
    'trg_sh_current_daily_summary_5m_insert',
    'trg_sh_current_daily_summary_late_insert',
  );
  const late = triggerBody(
    'trg_sh_current_daily_summary_late_insert',
    'trg_sh_current_daily_summary_update',
  );
  const correction = triggerBody('trg_sh_current_daily_summary_update');

  for (const body of [fiveMinute, late, correction]) {
    assert.doesNotMatch(body, /member_end_at|member_end|total_member_count/);
  }
});
