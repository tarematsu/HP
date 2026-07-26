import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { minuteFactRepairBurstComplete } from '../src/minute-fact-repair-burst.js';
import { processMinutePipelineBatch } from '../src/minute-pipeline-entry.js';

const repairSource = readFileSync(
  new URL('../src/minute-facts-repair.js', import.meta.url),
  'utf8',
);
const burstSource = readFileSync(
  new URL('../src/minute-fact-repair-burst.js', import.meta.url),
  'utf8',
);
const retireRepairIndexMigration = readFileSync(
  new URL('../../database/facts-migrations/043_retire_repair_candidate_index.sql', import.meta.url),
  'utf8',
);
const retireRepairWorkMigration = readFileSync(
  new URL('../../database/facts-migrations/044_retire_minute_fact_repair_work.sql', import.meta.url),
  'utf8',
);
const runtimeConfig = JSON.parse(readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));

test('production retires the completed repair burst while preserving bounded settings', () => {
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_BURST_ENABLED, false);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_BURST_INTERVAL_MINUTES, 60);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_CANDIDATE_LIMIT, 20);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_ENQUEUE_LIMIT, 2);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_DISPATCH_LIMIT, 2);
  assert.equal(runtimeConfig.vars.DERIVE_REVISION_CHUNK_TRACKS, 20);
  const rebuild = runtimeConfig.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-derive',
  );
  assert.equal(rebuild.max_batch_size, 1);
  assert.equal(rebuild.max_concurrency, 250);
});

test('repair candidate scan advances through the existing time index with durable state', () => {
  assert.match(repairSource, /INDEXED BY idx_sh_minute_facts_time/);
  assert.match(repairSource, /FROM sh_migration_state WHERE migration_key=\?/);
  assert.match(repairSource, /f\.minute_at>\? OR \(f\.minute_at=\? AND f\.id>\?\)/);
  assert.match(repairSource, /ON CONFLICT\(migration_key\) DO UPDATE SET/);
  assert.match(repairSource, /NOT EXISTS \(/);
  assert.match(repairSource, /r\.repair_key=\? AND r\.fact_id=f\.id/);
  assert.doesNotMatch(repairSource, /INDEXED BY idx_sh_minute_facts_repair_candidates/);
  assert.match(retireRepairIndexMigration, /DROP INDEX IF EXISTS idx_sh_minute_facts_repair_candidates/);
  assert.doesNotMatch(retireRepairIndexMigration, /CREATE INDEX|FROM sh_minute_facts|INSERT|UPDATE|DELETE/);
  assert.match(retireRepairWorkMigration, /WHERE job_kind='repair'/);
  assert.match(retireRepairWorkMigration, /status='done'/);
  assert.match(retireRepairWorkMigration, /phase='complete'/);
  assert.match(repairSource, /MAX_REPAIR_CANDIDATES = 100/);
  assert.match(repairSource, /MAX_REPAIR_ENQUEUES = 100/);
  assert.match(burstSource, /job_kind='repair'/);
  assert.match(burstSource, /job_kind: 'repair'/);
  assert.match(burstSource, /MAX_BURST_CANDIDATES = 20/);
  assert.match(burstSource, /MAX_BURST_ENQUEUES = 2/);
  assert.match(burstSource, /MAX_BURST_DISPATCH = 2/);
});

test('repair triggers bypass the ordinary historical rebuild pause', async () => {
  const calls = [];
  const batch = {
    queue: 'stationhead-minute-derive',
    messages: [{
      body: {
        message_type: 'minute-fact-derive',
        message_version: 1,
        job_id: 'minute-fact:10:60000',
        channel_id: 10,
        minute_at: 60_000,
        job_kind: 'repair',
      },
      ack() { calls.push('unexpected-ack'); },
    }],
  };
  const result = await processMinutePipelineBatch(
    batch,
    { HISTORICAL_REBUILD_ENABLED: false },
    {},
    {
      async processMinuteDeriveBatch(receivedBatch) {
        calls.push(receivedBatch.queue);
        return 'processed-repair';
      },
    },
  );
  assert.equal(result, 'processed-repair');
  assert.deepEqual(calls, ['stationhead-minute-derive']);
});

test('completion marker remains readable for external diagnostics', async () => {
  assert.equal(await minuteFactRepairBurstComplete({
    PAGES_RESPONSE_KV: { async get() { return '1'; } },
  }), true);
});
