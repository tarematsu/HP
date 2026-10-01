import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/run-local-minute-facts-rebuild.yml'),
  'utf8',
);

test('manual local minute facts rebuild is not gated by D1 budget telemetry', () => {
  assert.doesNotMatch(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_READ_PROJECTION_MINUTES/);
  assert.doesNotMatch(workflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(workflow, /d1-budget/);
  assert.match(workflow, /rebuild:\n    uses: \.\/\.github\/workflows\/database\.yml/);
  assert.match(workflow, /operation: minute-facts-local-rebuild/);
});

test('full rebuild is manual-only and has no automatic trigger', () => {
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*workflow_run:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
});
