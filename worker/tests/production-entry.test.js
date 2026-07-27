import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import productionApp, {
  runProductionCron,
  runProductionScheduled,
} from '../src/production-entry.js';

test('production cron delegates only to the primary collection app', async () => {
  const calls = [];
  const controller = { scheduledTime: 300_000, cron: '* * * * *' };
  const env = { marker: true };
  const ctx = {};
  const result = await runProductionScheduled(controller, env, ctx, {
    app: {
      async scheduled(receivedController, receivedEnv, receivedCtx) {
        calls.push([receivedController, receivedEnv, receivedCtx]);
        return 'primary-done';
      },
    },
  });

  assert.equal(result, 'primary-done');
  assert.deepEqual(calls, [[controller, env, ctx]]);
  assert.equal(await runProductionCron(controller, env, ctx, {
    app: { scheduled: async () => 'cron-done' },
  }), 'cron-done');
});

test('legacy production entry exposes no HTTP control or health endpoints', async () => {
  const requests = [
    new Request('https://buddies.test/'),
    new Request('https://buddies.test/health'),
    new Request('https://buddies.test/run', { method: 'POST' }),
    new Request('https://buddies.test/refresh-auth', { method: 'POST' }),
    new Request('https://buddies.test/coordination/lease'),
    new Request('https://buddies.test/ingest/email-recap', { method: 'POST' }),
  ];

  for (const request of requests) {
    const response = await productionApp.fetch(request, {}, {});
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
  }
  assert.equal((await productionApp.fetch(new Request('https://buddies.test/favicon.ico'), {}, {})).status, 204);
});

test('collector, recovery, and runtime Wrangler configurations own disjoint pipeline stages', () => {
  const collector = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-collector.jsonc', import.meta.url),
    'utf8',
  ));
  const recovery = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-recovery.jsonc', import.meta.url),
    'utf8',
  ));
  const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../src/raw-collector-entry.js', import.meta.url), 'utf8');
  const preparedCollector = readFileSync(
    new URL('../src/prepared-collector-runner.js', import.meta.url),
    'utf8',
  );
  const minuteProduction = readFileSync(
    new URL('../src/minute-production-entry.js', import.meta.url),
    'utf8',
  );

  assert.equal(collector.main, 'src/buddies-collector-entry.js');
  assert.equal(recovery.main, 'src/buddies-recovery-entry.js');
  assert.equal(runtime.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.deepEqual(collector.triggers?.crons, ['* * * * *']);
  assert.equal(recovery.triggers, undefined);
  assert.equal(runtime.triggers, undefined);
  assert.deepEqual(runtime.durable_objects, {
    bindings: [{ name: 'MINUTE_LIVE_JOB_COORDINATOR', class_name: 'MinuteLiveJobCoordinator' }],
  });
  assert.deepEqual(collector.d1_databases.map(({ binding }) => binding), ['BUDDIES_DB', 'MINUTE_DB']);
  assert.deepEqual(recovery.d1_databases.map(({ binding }) => binding), ['BUDDIES_DB']);
  assert.deepEqual(runtime.d1_databases.map(({ binding }) => binding), ['BUDDIES_DB', 'MINUTE_DB', 'OTHER_DB']);
  assert.equal(collector.d1_databases[0].database_name, 'stationhead-buddies');
  assert.equal(collector.d1_databases[1].database_name, 'stationhead-minute');

  assert.deepEqual(collector.queues?.producers.map(({ binding }) => binding), [
    'RAW_COLLECTION_QUEUE',
    'PERSIST_QUEUE',
    'INGEST_FINALIZE_QUEUE',
    'COMMENTS_QUEUE',
    'MINUTE_FACT_QUEUE',
    'MINUTE_LIVE_DERIVE_QUEUE',
    'MINUTE_ENRICHMENT_QUEUE',
    'TRACK_METADATA_QUEUE',
    'READ_MODEL_QUEUE',
  ]);
  assert.deepEqual(runtime.queues?.producers.map(({ binding }) => binding), [
    'MINUTE_FACT_QUEUE',
    'MINUTE_LIVE_DERIVE_QUEUE',
    'MINUTE_ENRICHMENT_QUEUE',
    'TRACK_METADATA_QUEUE',
  ]);
  assert.equal(collector.queues.consumers.length, 0);
  assert.equal(recovery.queues.consumers.length, 4);
  assert.equal(runtime.queues.consumers.length, 5);
  const recoveryQueues = new Set(recovery.queues.consumers.map(({ queue }) => queue));
  assert.equal(runtime.queues.consumers.some(({ queue }) => recoveryQueues.has(queue)), false);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-minute-rebuild'), false);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-host-monitor'), false);
  assert.equal(runtime.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-derive',
  ).max_concurrency, 1);
  assert.equal(collector.vars.COLLECTOR_INLINE_PIPELINE_ENABLED, true);
  assert.equal(collector.vars.COLLECTOR_MINUTE_FACT_INLINE_ENABLED, true);
  assert.equal(recovery.vars.COLLECTOR_INLINE_PIPELINE_ENABLED, false);
  assert.equal(runtime.vars.LIVE_DERIVE_INLINE_ENABLED, true);
  assert.equal(runtime.vars.MINUTE_FACT_TIMEOUT_MS, 0);
  assert.match(preparedCollector, /PERSIST_QUEUE: \{ value: null/);
  assert.match(preparedCollector, /INGEST_FINALIZE_QUEUE: \{ value: null/);
  assert.match(minuteProduction, /MINUTE_ENRICHMENT_QUEUE/);
  assert.match(minuteProduction, /runInlineLiveDerive/);
  assert.equal(runtime.kv_namespaces[0].binding, 'PAGES_RESPONSE_KV');
  assert.equal(runtime.r2_buckets[0].binding, 'PAGES_RESPONSE_R2');
  assert.match(source, /JSON\.parse/);
  assert.match(source, /normalizeSnapshot/);
  assert.match(source, /extractQueue/);
  assert.doesNotMatch(source, /response\.json|readModelPresentation|handoffMinuteFactJob/);

  const names = Object.keys(runtime.vars || {});
  for (const prefix of [
    'BUDDY_PLAYBACK_', 'HOST_', 'SOLO_', 'OFFICIAL_NEWS_', 'PAGES_',
    'SNAPSHOT_RETENTION_', 'STREAM_GOAL_', 'REBUILD_', 'GAP_SCAN_',
  ]) {
    assert.equal(names.some((name) => name.startsWith(prefix)), false, prefix);
  }
  assert.equal(names.some((name) => name.startsWith('DERIVE_')), true);
});
