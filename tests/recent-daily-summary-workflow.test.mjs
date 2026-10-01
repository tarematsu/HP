import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/run-daily-deep-repair.yml', import.meta.url),
  'utf8',
);

const publishCommand = 'node scripts/publish-recent-daily-summaries-actions.mjs';
const maintenanceCommand = 'node scripts/run-runtime-offline-maintenance-actions.mjs';

test('recent daily summaries run only before the isolated daily deep maintenance pass', () => {
  assert.match(workflow, /cron: '46 0 \* \* \*'/);
  assert.match(workflow, /name: Repair recent daily summaries/);
  assert.match(workflow, /publish-recent-daily-summaries-actions\.mjs/);
  assert.ok(workflow.indexOf(publishCommand) < workflow.indexOf(maintenanceCommand));
  assert.match(workflow, /RUNTIME_MAINTENANCE_COLLECTOR_ID: daily-deep-repair-actions/);
  assert.match(workflow, /RUNTIME_MAINTENANCE_SKIP_REBUILD: 'true'/);
  assert.doesNotMatch(workflow, /run-minute-facts-gap-scan-actions\.mjs/);
  assert.doesNotMatch(workflow, /RUNTIME_MAINTENANCE_D1_ALLOWED/);
  assert.doesNotMatch(workflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(workflow, /id: d1-budget/);
});
