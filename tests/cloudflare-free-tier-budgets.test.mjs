import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const script = readSource('.github/scripts/cloudflare_free_tier_audit.py');
const runtime = JSON.parse(readSource('worker/wrangler.runtime.jsonc'));
const collector = JSON.parse(readSource('worker/wrangler.buddies-collector.jsonc'));
const responseStore = readSource('worker/src/pages-response-store.js');
const responseEntry = readSource('worker/src/pages-read-model-entry.js');
const coreEntry = readSource('worker/src/runtime-orchestrator-entry.js');
const deployedEntry = readSource('worker/src/runtime-orchestrator-deployed-entry.js');
const collectorStatus = readSource('worker/src/collector-coordinator-status.js');
const queuePlanR2 = readSource('worker/src/queue-plan-r2.js');
const pagesMiddleware = readSource('site/functions/_middleware.js');
const pagesActions = readSource('worker/scripts/run-pages-read-model-actions.mjs');
const offlineActions = readSource('worker/scripts/run-runtime-offline-maintenance-actions.mjs');

test('Cloudflare resource budgets are fixed at 100 percent of included usage', () => {
  expectAll(script, [
    'Account-wide Cloudflare included-usage audit',
    'Account-wide Cloudflare free-tier 100% budgets',
    '"queueOperations": 10_000',
    '"doRequests": 100_000',
    '"doActiveGbSeconds": 13_000.0',
    '"doRowsRead": 5_000_000',
    '"doRowsWritten": 100_000',
    '"doStoredBytes": 5 * GB',
    '"r2ClassAOperations": 1_000_000',
    '"r2ClassBOperations": 10_000_000',
    '"r2StoredBytes": 10 * GB',
    '"kvReads": 100_000',
    '"kvWrites": 1_000',
    '"kvDeletes": 1_000',
    '"kvLists": 1_000',
    '"kvStoredBytes": 1_000_000_000',
    'queueMessageOperationsAdaptiveGroups',
    'durableObjectsInvocationsAdaptiveGroups',
    'durableObjectsPeriodicGroups',
    'r2OperationsAdaptiveGroups',
    'kvOperationsAdaptiveGroups',
    'kvStorageAdaptiveGroups',
    'sum { duration rowsRead rowsWritten }',
    'active_microseconds / 1_000_000 * 0.128',
    'usage["doActiveGbSeconds"] = _durable_object_duration_gb_seconds',
    'def aggregate(row:',
    '_ACCOUNT_SCOPE = "account"',
    '_PROJECTION_METHOD = "linear-from-utc-midnight"',
    '_DAILY_RATE_METRICS',
    '_MONTHLY_OR_STATE_METRICS',
    'project_daily_allowances',
    '"actualUsage": actual',
    'mixed-daily-projection-and-period-actual',
    'dimensions { actionType }',
    'dimensions { datetime }',
    'dimensions { date }',
    'resource_identifier not in document',
    '"namespaceId"',
    '"queueId"',
    '"bucketName"',
    'ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID"',
  ]);
  expectNone(script, [
    '"pipelineTransformBytes":',
    'pipelineOperators:',
    'configured_resource_ids',
    'core.',
    'accounts?per_page=50',
    'per_page=100',
    'importlib.util',
    'audit-cloudflare-free-tier-core',
  ]);
});

test('collector coordination and remaining realtime Queues fit daily budgets without runtime cron', () => {
  const collectorScheduledRequests = 24 * 60;
  const collectorStatusRequests = 24 * 6 * 2 + 24 * 2;
  const maximumRuntimeStateRequests = 24 * 60 * 10;
  const maximumCoordinatorRequests = collectorScheduledRequests
    + collectorStatusRequests
    + maximumRuntimeStateRequests;
  const maximumScheduledDuration = collectorScheduledRequests * 10 * 0.128;
  const maximumStatusWaitDuration = collectorStatusRequests * 15 * 0.128;
  const maximumCoordinatorDuration = maximumScheduledDuration + maximumStatusWaitDuration;
  const maximumCoordinatorRowsRead = maximumCoordinatorRequests * 32;
  const maximumCoordinatorRowsWritten = collectorScheduledRequests * 6
    + maximumRuntimeStateRequests;
  const maximumQueueOperations = (48 + 48 + 288 * 2) * 3;

  assert.equal(collectorStatusRequests, 336);
  assert.equal(maximumQueueOperations, 2_016);
  assert.ok(maximumCoordinatorRequests < 100_000);
  assert.ok(maximumCoordinatorDuration < 13_000);
  assert.ok(maximumCoordinatorRowsRead < 5_000_000);
  assert.ok(maximumCoordinatorRowsWritten < 100_000);
  assert.ok(maximumQueueOperations < 10_000);

  assert.deepEqual(collector.triggers.crons, ['* * * * *']);
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.durable_objects, undefined);
  assert.equal(runtime.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.deepEqual(Object.keys(runtime).includes('triggers'), false);
  expectNone(deployedEntry, ['scheduled:', 'runRuntimeOrchestratorScheduled']);
  expectNone(coreEntry, ['runCoreScheduled', 'runtime-scheduled', 'pages-read-model-scheduled-dispatch']);
  expectAll(collectorStatus, [
    "action: 'status'",
    'BUDDIES_COLLECTOR_COORDINATOR',
    'COLLECTOR_STATUS_DO_ENABLED',
  ]);
  expectAll(pagesActions, ['PAGES_READ_MODEL_DEADLINE_MS', 'runSplitTrackHistoryCycleStep']);
  expectAll(offlineActions, ['runRollupMaintenance', 'pruneOldSnapshots', 'runStreamGoalPrediction']);
});

test('surplus KV and R2 capacity replaces materialized-response D1 writes and reads', () => {
  expectAll(responseStore, ['if (kvSaved)', 'if (r2Saved) return r2Saved']);
  expectNone(responseStore, ['saveD1Response', 'sh_pages_response_manifest', 'sh_pages_response_chunks']);
  expectNone(pagesMiddleware, ['sh_pages_response_manifest', 'sh_pages_response_chunks']);
  assert.match(responseEntry, /await loadKv[\s\S]*\|\| await loadR2/);
  expectAll(queuePlanR2, ['operational/queue-plan/v1', 'await r2.delete']);

  const maximumDailyVariantWrites = 17;
  const maximumDailyDashboardWrites = 24 * 60 / 15;
  const maximumDailyKvWrites = maximumDailyDashboardWrites + maximumDailyVariantWrites;
  const maximumMonthlyR2Mirrors = maximumDailyKvWrites * 31;
  const maximumMonthlyQueuePlanReads = 24 * 60 * 31;
  const maximumMonthlyQueuePlanClassA = 3 * 24 * 60 * 31;
  assert.ok(maximumDailyKvWrites < 1_000);
  assert.ok(maximumMonthlyR2Mirrors + maximumMonthlyQueuePlanClassA < 1_000_000);
  assert.ok(maximumMonthlyQueuePlanReads < 10_000_000);
});
