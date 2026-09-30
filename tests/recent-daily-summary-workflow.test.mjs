import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/run-runtime-offline-maintenance.yml', import.meta.url),
  'utf8',
);

const gapScanCommand = 'node scripts/run-minute-facts-gap-scan-actions.mjs';
const publishCommand = 'node scripts/publish-recent-daily-summaries-actions.mjs';
const maintenanceCommand = 'node scripts/run-runtime-offline-maintenance-actions.mjs';

test('gap scan and recent daily summaries run before budget-aware heavy maintenance', () => {
  assert.match(workflow, /name: Scan minute-fact gaps, publish summaries, then run budget-aware maintenance/);
  assert.match(workflow, /worker\/scripts\/run-minute-facts-gap-scan-actions\.mjs/);
  assert.match(workflow, /worker\/scripts\/publish-recent-daily-summaries-actions\.mjs/);
  assert.match(workflow, /worker\/src\/recent-daily-summary-publication\.js/);
  assert.ok(workflow.indexOf(gapScanCommand) < workflow.indexOf(publishCommand));
  assert.ok(workflow.indexOf(publishCommand) < workflow.indexOf(maintenanceCommand));
  assert.match(workflow, /RUNTIME_MAINTENANCE_D1_ALLOWED: \$\{\{ steps\.d1-budget\.outputs\.allowed \}\}/);
  assert.doesNotMatch(
    workflow,
    /name: Scan minute-fact gaps, publish summaries, then run budget-aware heavy maintenance\n\s+if:/,
  );
});
