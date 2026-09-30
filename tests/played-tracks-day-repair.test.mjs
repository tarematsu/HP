import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { defaultRepairDay } from '../worker/scripts/repair-track-history-day-actions.mjs';

const repair = readFileSync(
  new URL('../worker/scripts/repair-track-history-day-actions.mjs', import.meta.url),
  'utf8',
);
const sync = readFileSync(
  new URL('../worker/scripts/sync-track-history-r2-days-actions.mjs', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../.github/workflows/repair-played-tracks-day.yml', import.meta.url),
  'utf8',
);

test('played-tracks refresh defaults to the latest completed UTC day', () => {
  assert.equal(defaultRepairDay(Date.UTC(2026, 8, 28, 0, 46)), '2026-09-27');
  assert.equal(defaultRepairDay(Date.UTC(2026, 8, 28, 23, 59)), '2026-09-27');
  assert.match(repair, /currentDayStart - DAY_MS/);
  assert.match(repair, /TRACK_HISTORY_REPAIR_DAY \|\| ''/);
});

test('played-tracks refresh is bounded to one UTC day and publishes only after non-empty aggregation', () => {
  assert.match(repair, /fromTs = Date\.parse\(`\$\{targetDay\}T00:00:00Z`\)/);
  assert.match(repair, /toTs = fromTs \+ DAY_MS/);
  assert.match(repair, /materializedTrackHistorySql\(\)/);
  assert.match(repair, /loadTrackHistoryData\(/);
  assert.match(repair, /track-history repair produced no playable rows/);
  assert.match(repair, /publishTrackHistoryR2DayRows/);
  assert.doesNotMatch(repair, /INSERT INTO sh_pages_track_history_read_model|DELETE FROM sh_pages_track_history_read_model/);
});

test('played-tracks refresh publishes only the changed day and updates the R2 date index', () => {
  assert.match(repair, /publishTrackHistoryR2DayRows/);
  assert.match(repair, /const r2 = await publish\(\{ day: targetDay, rows: repaired\.rows, now: generation \}\)/);
  assert.match(sync, /export async function publishTrackHistoryR2DayRows/);
  assert.match(sync, /trackHistoryDayObjectKey\(day\)/);
  assert.match(sync, /TRACK_HISTORY_DAY_INDEX_KEY/);
  assert.match(sync, /play_counts/);
  assert.doesNotMatch(repair, /sh_pages_track_history_read_model/);
});

test('played-tracks repair no longer stages duplicate D1 row-model writes', () => {
  assert.doesNotMatch(repair, /typeof db\.script === 'function'|await db\.script\(statements\)|await db\.batch\(statements\)/);
  assert.match(repair, /storage: 'r2-day'/);
});

test('played-tracks refresh workflow runs daily and still supports explicit manual days', () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: '46 0 \* \* \*'/);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: ''/);
  assert.match(workflow, /PAGES_RESPONSE_BUCKET: sh-pages-responses/);
  assert.match(workflow, /TRACK_HISTORY_REPAIR_DAY:/);
  assert.match(workflow, /repair-track-history-day-actions\.mjs/);
  assert.match(workflow, /timeout-minutes: 15/);
});
