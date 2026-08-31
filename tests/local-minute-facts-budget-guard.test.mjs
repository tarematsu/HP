import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/run-local-minute-facts-rebuild.yml'),
  'utf8',
);

test('local minute facts rebuild is fail-closed behind the shared D1 Actions budget guard', () => {
  assert.match(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT: '4000'/);
  assert.match(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT: '3500000'/);
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

test('guard changes trigger the protected workflow on main', () => {
  assert.match(workflow, /'\.github\/workflows\/run-local-minute-facts-rebuild\.yml'/);
  assert.match(workflow, /'scripts\/cloudflare-d1-write-guard\.mjs'/);
  assert.match(workflow, /'database\/minute-facts-local-rebuild\.trigger'/);
});
