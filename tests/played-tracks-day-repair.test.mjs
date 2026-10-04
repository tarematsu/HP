import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TRACK_HISTORY_SQL } from '../site/functions/lib/track-history-restored-handler.js';
import { defaultRepairDay } from '../worker/scripts/repair-track-history-day-actions.mjs';
import { directRevisionTrackHistorySql } from '../worker/src/track-history-direct-revision-sql.js';

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
  assert.match(repair, /loadDirectRevisionTrackHistoryData\(/);
  assert.match(repair, /PLAYBACK_EVENT_HISTORY_SQL/);
  assert.match(repair, /groupedRows = \[\.\.\.legacyPrefixRows, \.\.\.eventRows\]/);
  assert.match(repair, /track-history repair produced no playable rows/);
  assert.match(repair, /publishTrackHistoryR2DayRows/);
  assert.doesNotMatch(repair, /materializedTrackHistorySql\(|loadTrackHistoryData\(/);
  assert.doesNotMatch(repair, /INSERT INTO sh_pages_track_history_read_model|DELETE FROM sh_pages_track_history_read_model/);
});

test('played-tracks daily query keeps only the legacy prefix before exact playback events', () => {
  const sql = directRevisionTrackHistorySql();
  assert.match(sql, /starts\.latest_revision_id/);
  assert.match(sql, /JOIN sh_queue_revisions revisions ON revisions\.id=starts\.latest_revision_id/);
  assert.match(sql, /JOIN sh_queue_revision_items items ON items\.revision_id=revisions\.id/);
  assert.match(sql, /FROM sh_track_history_queue_starts starts/);
  assert.match(sql, /FROM sh_track_counter_current counters/);
  assert.doesNotMatch(sql, /FROM sh_track_counter_changes counters/);
  assert.doesNotMatch(sql, /sh_queue_items/);
  assert.equal((sql.match(/\?/g) || []).length, (TRACK_HISTORY_SQL.match(/\?/g) || []).length);
  assert.match(repair, /const eventStart = Math\.max\(fromTs, Math\.min\(toTs, firstEventAt\(eventRows, fromTs\)\)\)/);
  assert.match(repair, /fromTs,\s*eventStart,\s*TRACK_HISTORY_LIMIT,\s*false/);
  assert.match(repair, /'legacy-prefix\+playback-events'/);
  assert.match(repair, /'playback-events'/);
  assert.match(repair, /'legacy-reconstruction'/);
});

test('played-tracks repair canonicalizes grouped and like rows in one pass', () => {
  assert.match(repair, /const combinedRows = \[\.\.\.groupedRows, \.\.\.\(likeRows \|\| \[\]\)\];/);
  assert.match(repair, /const canonicalRows = await canonicalizeTrackRows\(db, combinedRows\);/);
  assert.match(repair, /canonicalRows\.slice\(0, groupedRows\.length\)/);
  assert.match(repair, /canonicalRows\.slice\(groupedRows\.length\)/);
  assert.doesNotMatch(repair, /Promise\.all\(\[\s*canonicalizeTrackRows\(db, groupedRows\)/);
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

test('played-tracks refresh reads Buddies playback events with the same bounded daily job', () => {
  assert.match(workflow, /BUDDIES_DATABASE_NAME: stationhead-buddies/);
  assert.match(repair, /process\.env\.BUDDIES_DATABASE_NAME \|\| 'stationhead-buddies'/);
  assert.match(repair, /remoteBuddiesDatabase\(\)/);
  assert.match(repair, /\.bind\(targetDay, fromTs, toTs, TRACK_HISTORY_LIMIT\)/);
});

test('played-tracks refresh runs once daily or by explicit manual dispatch, never on main pushes', () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: '46 0 \* \* \*'/);
  assert.doesNotMatch(workflow, /\n\s*push:\s*\n/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: ''/);
  assert.match(workflow, /PAGES_RESPONSE_BUCKET: sh-pages-responses/);
  assert.match(workflow, /TRACK_HISTORY_REPAIR_DAY:/);
  assert.match(workflow, /repair-track-history-day-actions\.mjs/);
  assert.match(workflow, /timeout-minutes: 15/);
});
