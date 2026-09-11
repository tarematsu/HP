import assert from 'node:assert/strict';
import test from 'node:test';

import { readMinuteHealth } from '../functions/lib/health-minute.js';

const NOW = 1_700_000_000_000;

function minuteDb(overrides = {}, liveDetails = {}) {
  return {
    prepare(sql) {
      if (/sh_minute_fact_inbox_stats/.test(sql)) {
        return {
          async first() {
            return {
              pending_count: 0,
              processing_count: 0,
              dead_count: 0,
              live_pending_count: 0,
              oldest_pending_minute: null,
              updated_at: NOW - 24 * 60 * 60_000,
              ...overrides,
            };
          },
        };
      }
      assert.match(sql, /sh_minute_fact_jobs/);
      assert.match(sql, /idx_sh_minute_fact_jobs_status_kind_minute/);
      assert.match(sql, /job_kind='live'/);
      return {
        async first() {
          return {
            live_processing_count: 0,
            live_dead_count: 0,
            oldest_live_pending_minute: null,
            ...liveDetails,
          };
        },
      };
    },
  };
}

test('minute health treats the active inbox as event-driven and retires periodic maintenance tasks', async () => {
  const health = await readMinuteHealth({ MINUTE_DB: minuteDb() }, NOW);
  assert.equal(health.ok, true);
  assert.deepEqual(health.tasks.map(({ task_name: task }) => task), ['derive', 'recovery', 'rebuild']);
  assert.equal(health.tasks[0].mode, 'event-driven');
  assert.equal(health.tasks[0].stale, false);
  assert.equal(health.tasks[1].mode, 'retired');
  assert.equal(health.tasks[2].mode, 'retired');
});

test('rebuild-only ledger backlog does not fail live derive health', async () => {
  const health = await readMinuteHealth({
    MINUTE_DB: minuteDb({
      pending_count: 109,
      processing_count: 0,
      dead_count: 0,
      live_pending_count: 0,
      oldest_pending_minute: NOW - 60 * 60_000,
    }),
  }, NOW);
  assert.equal(health.ok, true);
  assert.equal(health.tasks[0].pending_count, 0);
  assert.equal(health.tasks[0].oldest_pending_minute, null);
  assert.equal(health.tasks[0].pending_stale, false);
});

test('live derive health still fails for stale or dead live work', async () => {
  const pending = await readMinuteHealth({
    MINUTE_DB: minuteDb({
      pending_count: 40,
      live_pending_count: 20,
      oldest_pending_minute: NOW - 60 * 60_000,
    }, {
      oldest_live_pending_minute: NOW - 20 * 60_000,
    }),
  }, NOW);
  assert.equal(pending.ok, false);
  assert.equal(pending.tasks[0].pending_count, 20);
  assert.equal(pending.tasks[0].pending_stale, true);

  const dead = await readMinuteHealth({
    MINUTE_DB: minuteDb({ dead_count: 3 }, { live_dead_count: 1 }),
  }, NOW);
  assert.equal(dead.ok, false);
  assert.equal(dead.tasks[0].dead_count, 1);
});

test('offline dead work is excluded from live derive ownership', async () => {
  const health = await readMinuteHealth({
    MINUTE_DB: minuteDb({ dead_count: 4 }, { live_dead_count: 0 }),
  }, NOW);
  assert.equal(health.ok, true);
  assert.equal(health.tasks[0].dead_count, 0);
});
