import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = JSON.parse(readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));
const rollupMaintenance = readFileSync(
  new URL('../src/rollup-maintenance.js', import.meta.url),
  'utf8',
);
const repairSource = readFileSync(
  new URL('../src/minute-facts-repair.js', import.meta.url),
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

test('runtime cannot publish new repair or rebuild derive work', () => {
  const producers = new Set(runtime.queues.producers.map(({ binding }) => binding));
  const ordered = runtime.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-derive',
  );

  assert.equal(producers.has('MINUTE_DERIVE_QUEUE'), false);
  assert.equal(ordered.max_batch_size, 1);
  assert.equal(ordered.max_concurrency, 1);
  for (const name of [
    'MINUTE_FACT_REPAIR_BURST_ENABLED',
    'HISTORICAL_REBUILD_ENABLED',
    'REBUILD_HISTORICAL_BACKFILL_ENABLED',
  ]) {
    assert.equal(Object.hasOwn(runtime.vars, name), false, name);
  }
});

test('repair logic remains owned by bounded Actions rollup maintenance', () => {
  assert.match(rollupMaintenance, /runMinuteFactsRepair/);
  assert.match(repairSource, /INDEXED BY idx_sh_minute_facts_time/);
  assert.match(repairSource, /MAX_REPAIR_CANDIDATES = 100/);
  assert.match(repairSource, /MAX_REPAIR_ENQUEUES = 100/);
  assert.match(retireRepairIndexMigration, /DROP INDEX IF EXISTS idx_sh_minute_facts_repair_candidates/);
  assert.match(retireRepairWorkMigration, /WHERE job_kind='repair'/);
  assert.match(retireRepairWorkMigration, /status='done'/);
  assert.match(retireRepairWorkMigration, /phase='complete'/);
});
