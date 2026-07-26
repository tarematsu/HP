import assert from 'node:assert/strict';
import test from 'node:test';

import { collectorReadyForMaintenance } from '../src/collector-coordinator-status.js';
import { dispatchMinuteMaintenanceGate } from '../src/minute-maintenance-optimized-entry.js';

const MINUTE = 60_000;
const SCHEDULED_AT = Date.UTC(2026, 0, 1, 0, 7, 0);
const CRON = '5,7,9,15,17,19,25,27,29,35,37,39,45,47,49,55,57,59 * * * *';

function namespace(requests, response) {
  return {
    getByName(name) {
      assert.equal(name, 'scheduled-v1');
      return {
        async fetch(_url, init) {
          requests.push(JSON.parse(init.body));
          return Response.json(response);
        },
      };
    },
  };
}

test('maintenance readiness reads Collector DO before the D1 checkpoint', async () => {
  const requests = [];
  let d1Reads = 0;
  const result = await collectorReadyForMaintenance({
    BUDDIES_COLLECTOR_COORDINATOR: namespace(requests, {
      ready: true,
      last_success_at: SCHEDULED_AT - MINUTE,
      minute_at: SCHEDULED_AT - MINUTE,
      status: 'completed',
    }),
    BUDDIES_DB: {
      prepare() {
        d1Reads += 1;
        throw new Error('D1 fallback must not run');
      },
    },
  }, SCHEDULED_AT);

  assert.equal(result.ready, true);
  assert.equal(result.source, 'durable-object');
  assert.equal(d1Reads, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'status');
  assert.equal(requests[0].waitMs, 0);
  assert.equal(requests[0].minimumSuccessAt, SCHEDULED_AT - 22 * MINUTE);
});

test('rebuild gate dispatches from Collector DO readiness without D1 reads', async () => {
  const requests = [];
  const sends = [];
  const env = {
    HISTORICAL_REBUILD_ENABLED: true,
    REBUILD_HISTORICAL_BACKFILL_ENABLED: false,
    BUDDIES_COLLECTOR_COORDINATOR: namespace(requests, {
      ready: true,
      last_success_at: SCHEDULED_AT,
      minute_at: SCHEDULED_AT,
      status: 'completed',
    }),
    BUDDIES_DB: {
      prepare() { throw new Error('D1 fallback must not run'); },
    },
    MINUTE_REBUILD_QUEUE: {
      async send(body, options) { sends.push({ body, options }); },
    },
  };

  const result = await dispatchMinuteMaintenanceGate(
    { cron: CRON, scheduledTime: SCHEDULED_AT },
    env,
    'rebuild',
  );
  assert.equal(result.dispatched_stage, 'gap-scan');
  assert.equal(requests.length, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].body.stage, 'gap-scan');
});
