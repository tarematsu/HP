import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function expectAll(source, markers) {
  for (const marker of markers) assert.ok(source.includes(marker), marker);
}

function expectNone(source, markers) {
  for (const marker of markers) assert.ok(!source.includes(marker), marker);
}

test('HomePanel observability workflow keeps the production contract', () => {
  const workflow = read('.github/workflows/hp-observability.yml');
  const diagnostics = read('.github/actions/cloudflare-observability-diagnostics/action.yml');

  expectAll(workflow, [
    'workflows: ["Deploy unified homepanel-cloud Worker"]',
    'cron: "47 2 * * *"',
    'issues: write',
    'statuses: write',
    'D1_CONFIG_GLOBS: hp/cloud/wrangler.jsonc',
    'D1_DATABASE_NAME: homepanel-data',
    'DAILY_REQUEST_BUDGET: "3000"',
    'DAILY_REQUEST_RESERVE: "0"',
    'DAILY_D1_READ_BUDGET: "50000"',
    'DAILY_D1_WRITE_BUDGET: "3000"',
    'DAILY_QUEUE_BUDGET: "1000"',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
    'Collect top D1 queries by rows read',
    'query-cloudflare-d1-insights.mjs',
    'D1_INSIGHTS_OUTCOME',
    'id: observability-query',
    'uses: ./.github/actions/cloudflare-observability-diagnostics',
    'live-tail-worker: homepanel-cloud',
    'live-tail-seconds: "90"',
    'live-tail-probes: /v1/health,/',
    'LIVE_TAIL_LOG: live-tail.log',
    'telemetry-summary.md',
    'Publish persistent observability status',
    'publish-homepanel-observability-status.mjs',
    'steps.publish-status.outcome',
    'if: always()',
    'set -o pipefail',
    'retention-days: 1',
    'tests/homepanel-production-contract.test.mjs',
    'tests/observability-status-publisher.test.mjs',
  ]);
  expectAll(diagnostics, [
    'query-cloudflare-observability.py',
    'capture-cloudflare-live-tail.mjs',
    'wait "$query_pid" || query_status=$?',
    'wait "$tail_pid" || true',
    'exit "$query_status"',
  ]);
  expectNone(workflow, [
    'cron: "23 * * * *"',
    'actions: read',
    'Determine whether upstream run deployed the Worker',
    'steps.deployment.outputs',
    'Report deferred post-deployment runtime audit',
    'Start deep audit window',
    'AUDIT_FROM=',
    '\n  pull_request:',
    'R2_BUCKET',
    'publish-homepanel-observability-status.mjs --self-test',
  ]);
  assert.equal(workflow.match(/cron: "/g)?.length, 1);
  assert.ok(workflow.includes('\n  push:'));
  assert.ok(workflow.includes('branches: [main]'));
});

test('HomePanel observability tools retain budget, privacy, and status behavior', () => {
  const daily = read('.github/scripts/audit-cloudflare-daily-usage.py');
  const telemetry = read('.github/scripts/audit-cloudflare-telemetry.py');
  const insights = read('.github/scripts/query-cloudflare-d1-insights.mjs');
  const publisher = read('.github/scripts/publish-homepanel-observability-status.mjs');
  const publisherCore = read('.github/scripts/observability-status-publisher.mjs');

  expectAll(daily, [
    'queueMessageOperationsAdaptiveGroups',
    'billableOperations',
    'linear-from-utc-midnight',
    'project_daily_usage',
    'queueOperations',
    'Actual to now',
    'Projected 24h',
  ]);
  expectAll(insights, [
    'wrangler',
    'd1',
    'insights',
    '--sort-by',
    'reads',
    'totalRowsRead',
    'sanitizeQuery',
    'SQL fingerprint',
    'redactText',
  ]);
  expectAll(telemetry, [
    'scriptVersion',
    'fromisoformat',
    'old_version_invocations_excluded',
    'LIVE_TAIL_EVENT=',
    'missing_workers',
    'DURABLE_OBJECT_CPU_BUDGET_MS',
  ]);
  expectAll(publisher, [
    'HomePanel Observability Status',
    '<!-- homepanel-observability-status -->',
    './observability-status-publisher.mjs',
    'observability/d1-query-insights',
    'Top D1 queries by rows read',
    'publishCommitStatuses',
    'upsertStatusIssue',
  ]);
  expectNone(publisher, ['node:assert', '--self-test', 'function selfTest']);
  expectAll(publisherCore, [
    'MAX_SECTION_CHARS = 12_000',
    'MAX_ISSUE_BODY_CHARS = 60_000',
    "context: 'observability/overall'",
    'upsertStatusIssue',
    'Bearer [redacted]',
    'CLOUDFLARE_(?:API_TOKEN|BUILDS_API_TOKEN|ACCOUNT_ID)',
  ]);
  assert.ok(!telemetry.includes('R2_BUCKET'));
});

test('HomePanel unified runtime keeps storage and scheduler fast paths', () => {
  const unifiedWorker = read('hp/cloud/src/unified_worker.js');
  const workerEntry = read('hp/cloud/src/worker_entry.ts');
  const workerCore = read('hp/cloud/src/worker_core.ts');
  const deviceSync = read('hp/cloud/src/device_sync.ts');
  const scheduler = read('hp/cloud/src/scheduler.ts');
  const schedulerRuntime = read('hp/cloud/src/scheduler_runtime.ts');
  const octopusHistory = read('hp/cloud/src/octopus_history.ts');
  const radarSource = read('hp/cloud/src/radar_source.ts');
  const radarCache = read('hp/cloud/src/radar_bundle_cache.ts');

  expectAll(unifiedWorker, [
    'async scheduled(_controller, env, ctx)',
    'queueSchedulerWatchdog(env, ctx)',
  ]);
  assert.ok(!unifiedWorker.includes('runSchedulerTick'));
  expectAll(radarSource, ['await prewarmRadarBundle(env, payload']);
  expectAll(radarCache, ['cache.match(cacheKey)', 'bucket.get(R2_LATEST_BUNDLE_KEY)']);
  expectNone(workerEntry + workerCore, [
    'legacy-telemetry-endpoint-used',
    'receiveTelemetryOptimized',
  ]);
  expectAll(deviceSync, [
    'FROM sync_manifest AS manifest',
    ').first<DeviceSyncSnapshotRow>()',
  ]);
  expectAll(schedulerRuntime, [
    'RUNTIME_STORAGE_KEY',
    'state.storage.put(RUNTIME_STORAGE_KEY',
    'INSERT INTO job_events',
  ]);
  expectAll(scheduler, [
    'refreshStatusCounts(env.DB',
    'SYSTEM_JOBS_CACHE_MS = 60 * 60_000',
  ]);
  expectAll(octopusHistory, ['octopus_daily_totals', 'readDailyRange']);
});

test('HomePanel video runtime keeps deferred status and bounded liveness work', () => {
  const statusReport = read('hp/video/src/status-report.js');
  const statusLists = read('hp/video/src/status-lists.js');
  const liveness = read('hp/video/src/liveness-monitor.js');

  expectAll(statusReport, ['status-counts-stale-deferred-to-cleanup']);
  assert.ok(!statusReport.includes('refreshStatusCounts'));
  expectAll(statusLists, ['daily-cleanup']);
  assert.ok(!statusLists.includes('refreshStatusCounts'));
  expectAll(liveness, [
    'video_liveness_bounds',
    'LIVENESS_BATCH_SIZE = 5',
    "video.status = 'active'",
  ]);
  assert.ok(!liveness.includes('MAX(video.id)'));
});

test('HomePanel migrations preserve optimized runtime schema', () => {
  const readHotspots = read('hp/cloud/migrations/202607230500_d1_read_hotspots.sql');
  const runtimeReduction = read('hp/cloud/migrations/202607240200_d1_runtime_reduction.sql');

  expectAll(readHotspots, [
    'CREATE TABLE IF NOT EXISTS octopus_daily_totals',
    'CREATE VIEW IF NOT EXISTS video_liveness_bounds',
    'sqlite_sequence',
  ]);
  assert.ok(!readHotspots.includes('video_liveness_bound_on_insert'));
  expectAll(runtimeReduction, [
    'CREATE TABLE sync_manifest',
    'CREATE TABLE job_events',
    'WITHOUT ROWID',
    'DROP TABLE IF EXISTS environment_samples',
    'DROP TABLE IF EXISTS environment_buckets',
    'status_counts_on_video_update',
    'status_counts_on_ranking_insert',
    'dirty=0',
  ]);
});
