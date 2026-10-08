import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const script = readSource('.github/scripts/cloudflare_free_tier_audit.py');
const runtime = JSON.parse(readSource('worker/wrangler.runtime.jsonc'));
const collector = JSON.parse(readSource('worker/wrangler.buddies-collector.jsonc'));
const responseFetch = readSource('worker/src/pages-response-fetch-entry.js');
const responseStore = readSource('worker/src/pages-response-store.js');
const coreEntry = readSource('worker/src/runtime-orchestrator-entry.js');
const deployedEntry = readSource('worker/src/runtime-orchestrator-deployed-entry.js');
const collectorStatus = readSource('worker/src/collector-coordinator-status.js');
const queuePlanR2 = readSource('worker/src/queue-plan-r2.js');
const pagesMiddleware = readSource('site/functions/_middleware.js');
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
    'dimensions { queueID actionType consumerType }',
    '/accounts/{ACCOUNT}/queues?page={page}&per_page=50',
    'def queue_operation_breakdown(',
    'def projected_queue_breakdown(',
    '"queueOperationsBreakdown": queue_breakdown',
    '### Queue operation breakdown',
    'Cloudflare Queue breakdown coverage',
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

test('collector coordination and runtime live-job DO fit daily budgets without runtime cron', () => {
  const collectorScheduledRequests = 24 * 12;
  const collectorStatusRequests = 24 * 6 * 2 + 24 * 2;
  const maximumRuntimeD1StateRequests = 24 * 60 * 9;
  const runtimeLiveJobDoRequests = 24 * 60 * 2;
  const runtimeLiveJobDoRowsWritten = 24 * 60 * 2;
  const maximumCoordinatorRequests = collectorScheduledRequests
    + collectorStatusRequests
    + runtimeLiveJobDoRequests;
  const maximumScheduledDuration = collectorScheduledRequests * 10 * 0.128;
  const maximumStatusWaitDuration = collectorStatusRequests * 15 * 0.128;
  const maximumCoordinatorDuration = maximumScheduledDuration + maximumStatusWaitDuration;
  const maximumCoordinatorRowsRead = maximumCoordinatorRequests * 32;
  const maximumD1RowsWritten = collectorScheduledRequests * 6
    + maximumRuntimeD1StateRequests;
  const maximumDoRowsWritten = collectorScheduledRequests * 6
    + runtimeLiveJobDoRowsWritten;
  const maximumQueueOperations = (48 + 48 + 288 * 2) * 3;

  assert.equal(collectorStatusRequests, 336);
  assert.equal(maximumQueueOperations, 2_016);
  assert.ok(maximumCoordinatorRequests < 100_000);
  assert.ok(maximumCoordinatorDuration < 13_000);
  assert.ok(maximumCoordinatorRowsRead < 5_000_000);
  assert.ok(maximumD1RowsWritten < 100_000);
  assert.ok(maximumDoRowsWritten < 100_000);
  assert.ok(maximumQueueOperations < 10_000);

  assert.deepEqual(collector.triggers.crons, ['*/5 * * * *']);
  assert.equal(runtime.triggers, undefined);
  assert.deepEqual(runtime.durable_objects, {
    bindings: [{ name: 'MINUTE_LIVE_JOB_COORDINATOR', class_name: 'MinuteLiveJobCoordinator' }],
  });
  assert.equal(runtime.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.deepEqual(Object.keys(runtime).includes('triggers'), false);
  assert.equal(runtime.kv_namespaces, undefined);
  assert.equal(runtime.r2_buckets[0].binding, 'PAGES_RESPONSE_R2');
  expectNone(deployedEntry, ['scheduled:', 'runRuntimeOrchestratorScheduled']);
  expectAll(deployedEntry, ['MinuteLiveJobCoordinator']);
  expectNone(coreEntry, ['runCoreScheduled', 'runtime-scheduled', 'pages-read-model-scheduled-dispatch']);
  expectAll(collectorStatus, [
    "action: 'status'",
    'BUDDIES_COLLECTOR_COORDINATOR',
    'COLLECTOR_STATUS_DO_ENABLED',
  ]);
  expectAll(offlineActions, ['runRollupMaintenance', 'pruneOldSnapshots', 'runStreamGoalPrediction']);
});

test('Pages serving uses R2 without materialized-response D1 or KV fallback', () => {
  expectNone(pagesMiddleware, ['sh_pages_response_manifest', 'sh_pages_response_chunks']);
  expectAll(responseFetch, ['loadMaterializedResponse', 'pages-response-store.js']);
  expectNone(responseFetch, [
    'loadMaterializedR2Response',
    'PAGES_RESPONSE_KV',
    'sh_pages_response_manifest',
    'sh_pages_response_chunks',
    'runPagesReadModelCron',
  ]);
  expectAll(responseStore, ['loadMaterializedR2Response', 'pages-response/actions-v2/']);
  expectNone(responseStore, ['saveMaterializedR2Response', 'PAGES_RESPONSE_KV']);
  expectAll(queuePlanR2, ['operational/queue-plan/v1', 'await r2.delete']);

  const maximumDailyReadModelWrites = 17 + 24 * 60 / 15;
  const maximumMonthlyR2Writes = maximumDailyReadModelWrites * 31;
  const maximumMonthlyQueuePlanReads = 24 * 60 * 31;
  const maximumMonthlyQueuePlanClassA = 3 * 24 * 60 * 31;
  assert.ok(maximumMonthlyR2Writes + maximumMonthlyQueuePlanClassA < 1_000_000);
  assert.ok(maximumMonthlyQueuePlanReads < 10_000_000);
});
