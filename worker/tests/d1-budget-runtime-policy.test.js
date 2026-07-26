import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { pendingMinuteDeriveTriggers } from '../src/minute-derive-trigger.js';
import {
  LIVE_DERIVE_QUEUE_NAME,
  processMinutePipelineBatch,
  REBUILD_DERIVE_QUEUE_NAME,
} from '../src/minute-pipeline-entry.js';

function message(body) {
  const events = [];
  return {
    body,
    events,
    ack() { events.push('ack'); },
    retry() { events.push('retry'); },
  };
}

test('production runtime contains no historical rebuild configuration or entrypoints', () => {
  const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  for (const name of Object.keys(runtime.vars || {})) {
    assert.equal(name.startsWith('REBUILD_'), false, name);
    assert.equal(name.startsWith('GAP_SCAN_'), false, name);
  }
  assert.equal(Object.hasOwn(runtime.vars, 'HISTORICAL_REBUILD_ENABLED'), false);
  for (const path of [
    '../src/minute-rebuild-batched-entry.js',
    '../src/minute-rebuild-maintenance-entry.js',
    '../src/minute-maintenance-optimized-entry.js',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});

test('ordered historical derive backlog is acknowledged without loading D1 derive work', async () => {
  const queued = message({
    message_type: 'minute-fact-derive',
    message_version: 1,
    job_kind: 'rebuild',
  });
  let delegated = false;
  const result = await processMinutePipelineBatch({
    queue: REBUILD_DERIVE_QUEUE_NAME,
    messages: [queued],
  }, { HISTORICAL_REBUILD_ENABLED: true }, null, {
    async processMinuteDeriveBatch() { delegated = true; },
  });
  assert.deepEqual(queued.events, ['ack']);
  assert.equal(delegated, false);
  assert.equal(result.reason, 'rebuild-actions-owned');
});

test('stale historical messages on the live lane are also acknowledged', async () => {
  const queued = message({
    message_type: 'minute-fact-derive-stage',
    message_version: 1,
    stage: 'write',
    job: { id: 8, job_kind: 'rebuild' },
    payload: { rebuild: true },
  });
  let delegated = false;
  const result = await processMinutePipelineBatch({
    queue: LIVE_DERIVE_QUEUE_NAME,
    messages: [queued],
  }, {}, null, {
    async processMinuteDeriveBatch() { delegated = true; },
  });
  assert.deepEqual(queued.events, ['ack']);
  assert.equal(delegated, false);
  assert.equal(result.reason, 'rebuild-actions-owned');
});

test('recovery dispatch queries only durable live jobs with indexable predicates', async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      const record = { sql, args: [] };
      statements.push(record);
      return {
        bind(...args) { record.args = args; return this; },
        async all() { return { results: [] }; },
      };
    },
  };
  assert.deepEqual(await pendingMinuteDeriveTriggers({
    MINUTE_DB: db,
    HISTORICAL_REBUILD_ENABLED: true,
    MINUTE_FACT_REPAIR_BURST_ENABLED: true,
  }, { now: 123, limit: 2 }), []);
  assert.equal(statements.length, 2);
  for (const statement of statements) {
    assert.match(statement.sql, /job_kind='live'/);
    assert.doesNotMatch(statement.sql, /job_kind!='rebuild'|job_kind!='repair'|\sOR\s/);
    assert.deepEqual(statement.args, [123, 2]);
  }
});
