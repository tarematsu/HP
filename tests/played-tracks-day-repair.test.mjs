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

test('played-tracks refresh is bounded to one UTC day and writes the read model only after non-empty aggregation', () => {
  assert.match(repair, /fromTs = Date\.parse\(`\$\{targetDay\}T00:00:00Z`\)/);
  assert.match(repair, /toTs = fromTs \+ DAY_MS/);
  assert.match(repair, /materializedTrackHistorySql\(\)/);
  assert.match(repair, /loadTrackHistoryData\(/);
  assert.match(repair, /track-history repair produced no playable rows/);
  assert.match(repair, /INSERT INTO sh_pages_track_history_read_model/);
  assert.match(repair, /DELETE FROM sh_pages_track_history_read_model\s+WHERE play_date=\? AND updated_at<>\?/s);
});

test('played-tracks refresh publishes only the changed day and updates the R2 date index', () => {
  assert.match(repair, /syncTrackHistoryR2Day/);
  assert.match(repair, /const published = await sync\(\{ db, day: targetDay, now \}\)/);
  assert.match(sync, /export async function syncTrackHistoryR2Day/);
  assert.match(sync, /WHERE play_date=\?/);
  assert.match(sync, /trackHistoryDayObjectKey\(day\)/);
  assert.match(sync, /TRACK_HISTORY_DAY_INDEX_KEY/);
  assert.match(sync, /run a full sync before incremental refresh/);
  assert.match(sync, /Number\(existingIndex\.version\) !== 1/);
  assert.match(sync, /!Array\.isArray\(existingIndex\.dates\)/);
  assert.doesNotMatch(sync.slice(sync.indexOf('export async function syncTrackHistoryR2Day'), sync.indexOf('export async function syncTrackHistoryR2Days')), /GROUP BY play_date/);
});

test('played-tracks repair uses file-backed script writes when the remote adapter supports them', () => {
  assert.match(repair, /typeof db\.script === 'function'/);
  assert.match(repair, /await db\.script\(statements\)/);
  assert.match(repair, /await db\.batch\(statements\)/);
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
