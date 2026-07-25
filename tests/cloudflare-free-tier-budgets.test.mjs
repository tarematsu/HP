import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const script = readSource('.github/scripts/cloudflare_free_tier_audit.py');
const runtime = JSON.parse(readSource('worker/wrangler.runtime.jsonc'));
const responseStore = readSource('worker/src/pages-response-store.js');
const responseEntry = readSource('worker/src/pages-read-model-entry.js');
const coreEntry = readSource('worker/src/runtime-orchestrator-entry.js');
const deployedEntry = readSource('worker/src/runtime-orchestrator-deployed-entry.js');
const queuePlanR2 = readSource('worker/src/queue-plan-r2.js');
const pagesMiddleware = readSource('site/functions/_middleware.js');

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

test('the coordinators and remaining scheduled Queues fit safely below daily budgets', () => {
  const maximumCoordinatorRequests = 24 * 60 * 2;
  const maximumCoordinatorDuration = maximumCoordinatorRequests * 1 * 0.128;
  const maximumCoordinatorRowsRead = maximumCoordinatorRequests;
  const maximumCoordinatorRowsWritten = maximumCoordinatorRequests;
  const maximumQueueOperations = (48 + 48 + 17 + 288 * 2) * 3;
  assert.equal(maximumQueueOperations, 2_067);
  assert.ok(maximumCoordinatorRequests < 100_000);
  assert.ok(maximumCoordinatorDuration < 13_000);
  assert.ok(maximumCoordinatorRowsRead < 5_000_000);
  assert.ok(maximumCoordinatorRowsWritten < 100_000);
  assert.ok(maximumQueueOperations < 10_000);
  assert.equal(runtime.vars.RAW_COLLECTION_FALLBACK_INTERVAL_MINUTES, 5);
  assert.equal(runtime.vars.PIPELINE_ANALYTICS_INTERVAL_MINUTES, undefined);
  assert.equal(runtime.durable_objects.bindings[0].class_name, 'RuntimeCoordinator');
  assert.equal(runtime.main, 'src/runtime-orchestrator-deployed-entry.js');
  expectAll(deployedEntry, [
    'stub.fetch',
    "action: 'claim'",
    "action: 'release'",
    'return direct(controller, env, ctx, dependencies.direct)',
  ]);
  assert.match(deployedEntry, /primary-run-in-progress|runtime-coordinator-duplicate/);
  expectAll(coreEntry, ['runtime:last-scheduled-ticket', 'runPagesReadModelCron']);
  expectNone(coreEntry, ['pages-read-model-scheduled-dispatch']);
});

test('surplus KV and R2 capacity replaces materialized-response D1 writes and reads', () => {
  expectAll(responseStore, ['if (kvSaved)', 'if (r2Saved) return r2Saved']);
  expectNone(responseStore, ['saveD1Response', 'sh_pages_response_manifest', 'sh_pages_response_chunks']);
  expectNone(pagesMiddleware, ['sh_pages_response_manifest', 'sh_pages_response_chunks']);
  assert.match(responseEntry, /await loadKv[\s\S]*\|\| await loadR2/);
  expectAll(queuePlanR2, ['operational/queue-plan/v1', 'await r2.delete']);

  const maximumDailyVariantWrites = 17;
  const maximumDailyDashboardWrites = 24 * 60 / 5;
  const maximumDailyKvWrites = maximumDailyDashboardWrites + maximumDailyVariantWrites;
  const maximumMonthlyR2Mirrors = maximumDailyKvWrites * 31;
  const maximumMonthlyQueuePlanReads = 24 * 60 * 31;
  const maximumMonthlyQueuePlanClassA = 3 * 24 * 60 * 31;
  assert.ok(maximumDailyKvWrites < 1_000);
  assert.ok(maximumMonthlyR2Mirrors + maximumMonthlyQueuePlanClassA < 1_000_000);
  assert.ok(maximumMonthlyQueuePlanReads < 10_000_000);
});
