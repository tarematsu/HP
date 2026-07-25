import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const script = readFileSync(
  new URL('.github/scripts/cloudflare_free_tier_audit.py', root),
  'utf8',
);
const runtime = JSON.parse(readFileSync(new URL('worker/wrangler.runtime.jsonc', root), 'utf8'));
const responseStore = readFileSync(new URL('worker/src/pages-response-store.js', root), 'utf8');
const responseEntry = readFileSync(new URL('worker/src/pages-read-model-entry.js', root), 'utf8');
const coreEntry = readFileSync(new URL('worker/src/runtime-orchestrator-entry.js', root), 'utf8');
const deployedEntry = readFileSync(new URL('worker/src/runtime-orchestrator-deployed-entry.js', root), 'utf8');
const queuePlanR2 = readFileSync(new URL('worker/src/queue-plan-r2.js', root), 'utf8');
const pagesMiddleware = readFileSync(new URL('site/functions/_middleware.js', root), 'utf8');

test('Cloudflare resource budgets are fixed at 80 percent of included usage', () => {
  assert.match(script, /Account-wide Cloudflare included-usage audit/);
  assert.match(script, /Account-wide Cloudflare free-tier 80% budgets/);
  assert.match(script, /"queueOperations": 8_000/);
  assert.match(script, /"doRequests": 80_000/);
  assert.match(script, /"doActiveGbSeconds": 10_400\.0/);
  assert.match(script, /"doRowsRead": 4_000_000/);
  assert.match(script, /"doRowsWritten": 80_000/);
  assert.match(script, /"doStoredBytes": 4 \* GB/);
  assert.match(script, /"r2ClassAOperations": 800_000/);
  assert.match(script, /"r2ClassBOperations": 8_000_000/);
  assert.match(script, /"r2StoredBytes": 8 \* GB/);
  assert.match(script, /"kvReads": 80_000/);
  assert.match(script, /"kvWrites": 800/);
  assert.match(script, /"kvDeletes": 800/);
  assert.match(script, /"kvLists": 800/);
  assert.match(script, /"kvStoredBytes": 800_000_000/);
  assert.match(script, /queueMessageOperationsAdaptiveGroups/);
  assert.match(script, /durableObjectsInvocationsAdaptiveGroups/);
  assert.match(script, /durableObjectsPeriodicGroups/);
  assert.match(script, /r2OperationsAdaptiveGroups/);
  assert.match(script, /kvOperationsAdaptiveGroups/);
  assert.match(script, /kvStorageAdaptiveGroups/);
  assert.match(script, /sum \{ duration rowsRead rowsWritten \}/);
  assert.match(script, /active_microseconds \/ 1_000_000 \* 0\.128/);
  assert.match(script, /usage\["doActiveGbSeconds"\] = _durable_object_duration_gb_seconds/);
  assert.match(script, /def aggregate\(row:/);
  assert.match(script, /_ACCOUNT_SCOPE = "account"/);
  assert.match(script, /_PROJECTION_METHOD = "linear-from-utc-midnight"/);
  assert.match(script, /_DAILY_RATE_METRICS/);
  assert.match(script, /_MONTHLY_OR_STATE_METRICS/);
  assert.match(script, /project_daily_allowances/);
  assert.match(script, /"actualUsage": actual/);
  assert.match(script, /mixed-daily-projection-and-period-actual/);
  assert.match(script, /dimensions \{ actionType \}/);
  assert.match(script, /dimensions \{ datetime \}/);
  assert.match(script, /dimensions \{ date \}/);
  assert.match(script, /resource_identifier not in document/);
  assert.match(script, /"namespaceId"/);
  assert.match(script, /"queueId"/);
  assert.match(script, /"bucketName"/);
  assert.doesNotMatch(script, /"pipelineTransformBytes"\s*:/);
  assert.doesNotMatch(script, /^\s+pipelineOperators:/m);
  assert.match(script, /ACCOUNT = os\.environ\.get\("CLOUDFLARE_ACCOUNT_ID"/);
  assert.doesNotMatch(
    script,
    /configured_resource_ids|core\.|accounts\?per_page=50|per_page=100|importlib\.util|audit-cloudflare-free-tier-core/,
  );
});

test('the coordinators and remaining scheduled Queues fit safely below daily budgets', () => {
  const maximumCoordinatorRequests = 24 * 60 * 2;
  const maximumCoordinatorDuration = maximumCoordinatorRequests * 1 * 0.128;
  const maximumCoordinatorRowsRead = maximumCoordinatorRequests;
  const maximumCoordinatorRowsWritten = maximumCoordinatorRequests;
  const maximumQueueOperations = (48 + 48 + 17 + 288 * 2) * 3;
  assert.equal(maximumQueueOperations, 2_067);
  assert.ok(maximumCoordinatorRequests < 80_000);
  assert.ok(maximumCoordinatorDuration < 10_400);
  assert.ok(maximumCoordinatorRowsRead < 4_000_000);
  assert.ok(maximumCoordinatorRowsWritten < 80_000);
  assert.ok(maximumQueueOperations < 8_000);
  assert.equal(runtime.vars.RAW_COLLECTION_FALLBACK_INTERVAL_MINUTES, 5);
  assert.equal(runtime.vars.PIPELINE_ANALYTICS_INTERVAL_MINUTES, undefined);
  assert.equal(runtime.durable_objects.bindings[0].class_name, 'RuntimeCoordinator');
  assert.equal(runtime.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.match(deployedEntry, /stub\.fetch/);
  assert.match(deployedEntry, /action: 'claim'/);
  assert.match(deployedEntry, /action: 'release'/);
  assert.match(deployedEntry, /primary-run-in-progress|runtime-coordinator-duplicate/);
  assert.match(coreEntry, /runtime:last-scheduled-ticket/);
  assert.match(deployedEntry, /return direct\(controller, env, ctx, dependencies\.direct\)/);
  assert.match(coreEntry, /runPagesReadModelCron/);
  assert.doesNotMatch(coreEntry, /pages-read-model-scheduled-dispatch/);
});

test('surplus KV and R2 capacity replaces materialized-response D1 writes and reads', () => {
  assert.match(responseStore, /if \(kvSaved\)/);
  assert.match(responseStore, /if \(r2Saved\) return r2Saved/);
  assert.doesNotMatch(responseStore, /saveD1Response|sh_pages_response_manifest|sh_pages_response_chunks/);
  assert.doesNotMatch(pagesMiddleware, /sh_pages_response_manifest|sh_pages_response_chunks/);
  assert.match(responseEntry, /await loadKv[\s\S]*\|\| await loadR2/);
  assert.match(queuePlanR2, /operational\/queue-plan\/v1/);
  assert.match(queuePlanR2, /await r2\.delete/);

  const maximumDailyVariantWrites = 17;
  const maximumDailyDashboardWrites = 24 * 60 / 5;
  const maximumDailyKvWrites = maximumDailyDashboardWrites + maximumDailyVariantWrites;
  const maximumMonthlyR2Mirrors = maximumDailyKvWrites * 31;
  const maximumMonthlyQueuePlanReads = 24 * 60 * 31;
  const maximumMonthlyQueuePlanClassA = 3 * 24 * 60 * 31;
  assert.ok(maximumDailyKvWrites < 800);
  assert.ok(maximumMonthlyR2Mirrors + maximumMonthlyQueuePlanClassA < 800_000);
  assert.ok(maximumMonthlyQueuePlanReads < 8_000_000);
});
