import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  combinedGuardDecision,
  guardDecision,
  runD1WriteGuardCli,
} from '../scripts/cloudflare-d1-write-guard.mjs';

test('allows Actions work below the 4000-row hourly limit', () => {
  assert.deepEqual(guardDecision(3999), {
    allowed: true,
    rowsWritten: 3999,
    limit: 4000,
    headroom: 1,
  });
});

test('stops Actions work at or above the 4000-row hourly limit', () => {
  assert.equal(guardDecision(4000).allowed, false);
  assert.equal(guardDecision(4001).allowed, false);
});

test('daily read pressure blocks D1-heavy Actions before the free-tier ceiling', () => {
  assert.deepEqual(combinedGuardDecision(100, 3_499_999, 4000, 3_500_000), {
    allowed: true,
    rowsWritten: 100,
    limit: 4000,
    headroom: 3900,
    writeAllowed: true,
    readAllowed: true,
    rowsRead: 3_499_999,
    readLimit: 3_500_000,
    readHeadroom: 1,
  });
  const blocked = combinedGuardDecision(100, 3_500_000, 4000, 3_500_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.writeAllowed, true);
  assert.equal(blocked.readAllowed, false);
});

test('unavailable write telemetry fails closed without failing the workflow step', async () => {
  const result = await runD1WriteGuardCli({
    limit: 4000,
    async run() { throw new Error('GraphQL unavailable'); },
  });
  assert.deepEqual(result, {
    allowed: false,
    rowsWritten: null,
    limit: 4000,
    headroom: 0,
    reason: 'telemetry-unavailable',
    error: 'GraphQL unavailable',
  });
});

test('read-model workflow gates Actions generation while KV and R2 keep serving', async () => {
  const workflow = await readFile(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');
  assert.match(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT: '4000'/);
  assert.match(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT: '3500000'/);
  assert.match(workflow, /id: d1-write-budget/);
  assert.match(workflow, /outputs\.rows_read/);
  assert.match(workflow, /outputs\.reason/);
  assert.match(workflow, /telemetry-unavailable/);
  assert.match(workflow, /if: steps\.d1-write-budget\.outputs\.allowed == 'true'/);
  assert.match(workflow, /Existing KV\/R2 responses remain active/);
  assert.doesNotMatch(workflow, /worker.*retry|retry.*worker/i);
});
