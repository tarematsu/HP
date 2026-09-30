import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/run-local-minute-facts-rebuild.yml'),
  'utf8',
);

test('manual local minute facts rebuild reserves D1 read headroom for higher-priority read models', () => {
  assert.match(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT: '4000'/);
  assert.match(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT: '3000000'/);
  assert.match(workflow, /D1_ACTIONS_READ_PROJECTION_MINUTES: '60'/);
  assert.match(workflow, /name: Check D1 Actions read and write budgets\n        id: d1-budget\n        run: node \.\.\/scripts\/cloudflare-d1-write-guard\.mjs/);
  assert.match(workflow, /allowed: \$\{\{ steps\.d1-budget\.outputs\.allowed \}\}/);
  assert.match(workflow, /rebuild:\n    needs: d1-budget/);
  assert.match(
    workflow,
    /if: needs\.d1-budget\.result == 'success' && needs\.d1-budget\.outputs\.allowed == 'true'/,
  );
  assert.match(workflow, /Local minute facts rebuild: deferred/);
});

test('full rebuild is manual-only and has no automatic trigger', () => {
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*workflow_run:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
});
