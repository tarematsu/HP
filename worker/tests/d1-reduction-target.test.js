import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  processBudgetedQueueStructureTask,
  queueLikesStageRequired,
  queuePersistenceCheckpointDue,
} from '../src/persist-structure-budget-entry.js';
import { QUEUE_PLAN_PREFIX } from '../src/queue-plan-r2.js';

const MINUTE_MS = 60_000;
const TEST_CHECKPOINT_MINUTES = 20;

function stableBody(observedAt) {
  return {
    message_type: 'stationhead-persistence-task',
    message_version: 1,
    task: 'queue',
    observed_at: observedAt,
    collector_id: 'test',
    data: {
      station_id: 1,
      queue_id: 2,
      start_time: 3,
      tracks: [{ position: 0, spotify_id: 'track-1', bite_count: 7 }],
    },
    analysis: {
      structural_hash: 'structure-stable',
      source_structural_hash: 'structure-stable',
      likes_hash: 'likes-stable',
      source_likes_hash: 'likes-stable',
      likes: { complete: true, payload: [{ track_key: 'spotify:track-1', like_count: 7 }] },
    },
  };
}

function fakeEnv(overrides = {}) {
  return {
    DB: { prepare() { throw new Error('unexpected D1 access'); } },
    QUEUE_LIKES_REPAIR_ENABLED: false,
    QUEUE_STABLE_CHECKPOINT_MINUTES: TEST_CHECKPOINT_MINUTES,
    ...overrides,
  };
}

class FakeR2 {
  constructor() {
    this.values = new Map();
    this.reads = 0;
    this.puts = 0;
    this.deletes = 0;
  }

  async get(key) {
    this.reads += 1;
    const value = this.values.get(key);
    return value == null ? null : { async json() { return JSON.parse(value); } };
  }

  async put(key, value) {
    this.puts += 1;
    this.values.set(key, value);
  }

  async delete(key) {
    this.deletes += 1;
    this.values.delete(key);
  }
}

function seedStablePlan(r2, observedAt = TEST_CHECKPOINT_MINUTES * MINUTE_MS) {
  r2.values.set(`${QUEUE_PLAN_PREFIX}1.json`, JSON.stringify({
    version: 1,
    station_id: 1,
    queue_id: 2,
    start_time: 3,
    structural_hash: 'structure-stable',
    likes_hash: 'likes-stable',
    observed_at: observedAt,
  }));
}

test('stable queue hashes bypass the second likes read unless repair is requested', () => {
  const body = stableBody(21 * MINUTE_MS);
  const plan = { structure_changed: false, likes_hash: 'likes-stable' };
  assert.equal(queueLikesStageRequired(body, plan, fakeEnv()), false);
  assert.equal(queueLikesStageRequired(body, plan, fakeEnv({ QUEUE_LIKES_REPAIR_ENABLED: true })), true);
  assert.equal(queueLikesStageRequired({
    ...body,
    analysis: { ...body.analysis, likes_hash: 'likes-new' },
  }, plan, fakeEnv()), true);
});

test('stable queue checkpoint occurs once per configured slot', () => {
  assert.equal(queuePersistenceCheckpointDue(20 * MINUTE_MS, fakeEnv()), true);
  assert.equal(queuePersistenceCheckpointDue(21 * MINUTE_MS, fakeEnv()), false);
  assert.equal(queuePersistenceCheckpointDue(40 * MINUTE_MS, fakeEnv()), true);
});

test('stable non-checkpoint invocation uses R2 without reading D1', async () => {
  const r2 = new FakeR2();
  seedStablePlan(r2);
  const result = await processBudgetedQueueStructureTask(
    fakeEnv({ PAGES_RESPONSE_R2: r2 }),
    stableBody(21 * MINUTE_MS),
  );
  assert.equal(result.stable_checkpoint_skipped, true);
  assert.equal(r2.reads, 1);
  assert.equal(r2.puts, 0);
  assert.equal(r2.deletes, 0);
});

test('checkpoint refreshes the R2 plan from one D1 planning read', async () => {
  const r2 = new FakeR2();
  seedStablePlan(r2);
  let planningReads = 0;
  const result = await processBudgetedQueueStructureTask(
    fakeEnv({ PAGES_RESPONSE_R2: r2 }),
    stableBody(40 * MINUTE_MS),
    {
      async prepareQueueStructurePersistence() {
        planningReads += 1;
        return {
          structure_changed: false,
          stale_current: false,
          station_id: 1,
          queue_id: 2,
          start_time: 3,
          structural_hash: 'structure-stable',
          likes_hash: 'likes-stable',
        };
      },
      async sendPersistenceContinuation() {},
    },
  );
  assert.equal(result.stable_checkpoint_skipped, false);
  assert.equal(planningReads, 1);
  assert.equal(r2.deletes, 1);
  assert.equal(r2.puts, 1);
});

test('structure writes preserve the likes stage so bite counts are materialized', async () => {
  const sent = [];
  const body = {
    ...stableBody(21 * MINUTE_MS),
    stage: 'structure-write',
    structure_cursor: 0,
    structure_plan: {
      structure_changed: true,
      likes_hash: 'likes-stable',
      structural_hash: 'structure-new',
      write_positions: [0],
    },
  };
  const result = await processBudgetedQueueStructureTask(fakeEnv(), body, {
    async commitQueueStructurePersistence() {
      return { structureChanged: true, itemsWritten: 1 };
    },
    async sendPersistenceContinuation(message) { sent.push(message); },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].stage, 'likes');
  assert.equal(result.likes_deferred, true);
  assert.equal(result.finalization_deferred, true);
});

test('production checkpoint ownership is split between collector and read-model code', () => {
  const collector = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-collector.jsonc', import.meta.url),
    'utf8',
  ));
  const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  const readModelStages = readFileSync(new URL('../src/read-model-stages.js', import.meta.url), 'utf8');

  assert.equal(collector.vars.SNAPSHOT_PERSIST_INTERVAL_MS, 60 * MINUTE_MS);
  assert.equal(collector.vars.QUEUE_STABLE_CHECKPOINT_MINUTES, 60);
  assert.equal(Object.hasOwn(runtime.vars, 'SNAPSHOT_PERSIST_INTERVAL_MS'), false);
  assert.match(readModelStages, /READ_MODEL_CHECKPOINT_MS = 20 \* 60_000/);

  const previous = { reads: 2 * TEST_CHECKPOINT_MINUTES, writes: TEST_CHECKPOINT_MINUTES };
  const optimized = { reads: 1, writes: 1 };
  assert.ok(optimized.reads / previous.reads <= 0.50);
  assert.ok(optimized.writes / previous.writes <= 0.30);
  assert.equal(1 - optimized.reads / previous.reads, 0.975);
  assert.equal(1 - optimized.writes / previous.writes, 0.95);
});

test('collector progress and metadata timestamps retain bounded checkpoint constants', () => {
  const preparedCollector = readFileSync(new URL('../src/prepared-collector-runner.js', import.meta.url), 'utf8');
  const finalize = readFileSync(new URL('../src/ingest-finalize-entry.js', import.meta.url), 'utf8');
  const minuteWrites = readFileSync(new URL('../src/minute-d1-write-throttle.js', import.meta.url), 'utf8');

  assert.match(preparedCollector, /COLLECTOR_STATE_CHECKPOINT_MS = 20 \* 60_000/);
  assert.match(finalize, /COLLECTOR_STATE_CHECKPOINT_MS = 20 \* 60_000/);
  assert.match(minuteWrites, /CHECKPOINT_MS = 20 \* 60_000/);
});
