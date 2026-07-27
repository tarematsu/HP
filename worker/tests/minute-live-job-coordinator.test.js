import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimCoordinatedLiveJob,
  completeCoordinatedLiveJob,
  MinuteLiveJobCoordinator,
  releaseCoordinatedLiveJobs,
} from '../src/minute-live-job-coordinator.js';
import { claimBudgetedLiveDeriveJob } from '../src/minute-live-trigger-lease.js';

function fakeStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { return values.delete(key); },
  };
}

function readOnlyJobDb(job) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      assert.match(sql, /^SELECT \* FROM sh_minute_fact_jobs/);
      return {
        bind(channelId, minuteAt) {
          assert.equal(channelId, job.channel_id);
          assert.equal(minuteAt, job.minute_at);
          return { async first() { return structuredClone(job); } };
        },
      };
    },
  };
}

function namespaceFor(coordinator) {
  return {
    getByName(name) {
      assert.equal(name, 'live-v1');
      return { fetch: (request, init) => coordinator.fetch(new Request(request, init)) };
    },
  };
}

const trigger = {
  message_type: 'minute-fact-derive',
  message_version: 1,
  job_id: 'minute-fact:10:60000',
  channel_id: 10,
  minute_at: 60_000,
  job_kind: 'live',
};

const job = {
  id: 7,
  channel_id: 10,
  minute_at: 60_000,
  payload_version: 1,
  payload_json: '{"payload_version":1}',
  job_kind: 'live',
  status: 'pending',
  attempts: 0,
  next_attempt_at: 0,
};

test('live job coordinator claims and rejects an overlapping lease without D1 writes', async () => {
  const storage = fakeStorage();
  const db = readOnlyJobDb(job);
  const coordinator = new MinuteLiveJobCoordinator({ storage }, { MINUTE_DB: db });

  const first = await coordinator.claim({ trigger, now: 1_000, lease_ms: 60_000 });
  assert.equal(first.job.id, 7);
  assert.equal(first.job.attempts, 1);
  assert.equal(first.job.lease_until, 61_000);

  const overlapping = await coordinator.claim({ trigger, now: 2_000, lease_ms: 60_000 });
  assert.equal(overlapping.job, null);
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls.some((sql) => /UPDATE|INSERT|DELETE/i.test(sql)), false);
});

test('client helpers release and complete the Durable Object lease', async () => {
  const storage = fakeStorage();
  const coordinator = new MinuteLiveJobCoordinator({ storage }, { MINUTE_DB: readOnlyJobDb(job) });
  const env = { MINUTE_LIVE_JOB_COORDINATOR: namespaceFor(coordinator) };

  const claimed = await claimCoordinatedLiveJob(env, trigger, { now: 1_000, leaseMs: 60_000 });
  assert.equal(claimed.id, 7);
  assert.equal((await releaseCoordinatedLiveJobs(env, [7], { now: 2_000 })).released, 1);

  const reclaimed = await claimCoordinatedLiveJob(env, trigger, { now: 2_001, leaseMs: 60_000 });
  assert.equal(reclaimed.id, 7);
  assert.equal((await completeCoordinatedLiveJob(env, 7)).completed, true);
  assert.equal(storage.values.has('live-job:7'), false);
});

test('budgeted live claim prefers the coordinator and never executes a D1 UPDATE', async () => {
  const storage = fakeStorage();
  const db = readOnlyJobDb(job);
  const coordinator = new MinuteLiveJobCoordinator({ storage }, { MINUTE_DB: db });
  const env = {
    MINUTE_DB: {
      prepare() { throw new Error('D1 write fallback must not run'); },
    },
    MINUTE_LIVE_JOB_COORDINATOR: namespaceFor(coordinator),
  };

  const claimed = await claimBudgetedLiveDeriveJob(env, trigger, { now: 1_000, leaseMs: 60_000 });
  assert.equal(claimed.id, 7);
  assert.equal(db.calls.some((sql) => /UPDATE|INSERT|DELETE/i.test(sql)), false);
});
