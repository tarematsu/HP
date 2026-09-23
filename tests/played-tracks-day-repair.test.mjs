import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repair = readFileSync(
  new URL('../worker/scripts/repair-track-history-day-actions.mjs', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../.github/workflows/repair-played-tracks-day.yml', import.meta.url),
  'utf8',
);

test('played-tracks repair is bounded to one explicit UTC day and writes the read model only after non-empty aggregation', () => {
  assert.match(repair, /DEFAULT_REPAIR_DAY = '2026-09-22'/);
  assert.match(repair, /fromTs = Date\.parse\(`\$\{day\}T00:00:00Z`\)/);
  assert.match(repair, /toTs = fromTs \+ DAY_MS/);
  assert.match(repair, /materializedTrackHistorySql\(\)/);
  assert.match(repair, /loadTrackHistoryData\(/);
  assert.match(repair, /track-history repair produced no playable rows/);
  assert.match(repair, /INSERT INTO sh_pages_track_history_read_model/);
  assert.match(repair, /DELETE FROM sh_pages_track_history_read_model\s+WHERE play_date=\? AND updated_at<>\?/s);
});

test('played-tracks repair uses file-backed script writes when the remote adapter supports them', () => {
  assert.match(repair, /typeof db\.script === 'function'/);
  assert.match(repair, /await db\.script\(statements\)/);
  assert.match(repair, /await db\.batch\(statements\)/);
});

test('played-tracks repair workflow is one-shot on relevant main changes and has no recurring schedule', () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /TRACK_HISTORY_REPAIR_DAY:/);
  assert.match(workflow, /repair-track-history-day-actions\.mjs/);
  assert.match(workflow, /timeout-minutes: 15/);
});
