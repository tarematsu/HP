import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  minuteFactStatements,
  resetMinuteFactStatementPlanCacheForTests,
} from '../src/minute-facts-statement-plan.js';

function fakeDb() {
  return {
    prepared: [],
    prepare(sql) {
      const statement = {
        sql: String(sql),
        params: [],
        bind(...params) { this.params = params; return this; },
      };
      this.prepared.push(statement);
      return statement;
    },
  };
}

function fact(overrides = {}) {
  return {
    channel_id: 318,
    minute_at: 1_700_000_100_000,
    observed_at: 1_700_000_101_000,
    source_code: 1,
    source_priority: 100,
    quality_score: 1,
    broadcast_session_id: 12,
    queue_revision_id: null,
    queue_available: 0,
    queue_position: null,
    total_member_count: 10_000,
    ...overrides,
  };
}

beforeEach(() => resetMinuteFactStatementPlanCacheForTests());

test('live five-minute fact upserts its own dashboard bucket and checkpoints changed member state', () => {
  const db = fakeDb();
  const statements = minuteFactStatements(db, fact({
    queue_revision_id: 44,
    queue_available: 1,
    queue_position: 3,
  }));
  const rollup = statements.find(({ sql }) => sql.includes('INSERT INTO sh_dashboard_history_5m'));

  assert.equal(statements.length, 4);
  assert.ok(rollup);
  assert.deepEqual(rollup.params, [1_700_000_100_000, 318, 1_700_000_100_000]);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_total_member_daily')), true);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_minute_fact_context_v2')), true);
  assert.equal(statements.some(({ sql }) => sql.includes('DELETE FROM sh_minute_fact_context_v2')), false);
});

test('stable live fact still updates dashboard but skips unchanged member D1 work', () => {
  const db = fakeDb();
  minuteFactStatements(db, fact());
  const statements = minuteFactStatements(db, fact({
    minute_at: 1_700_000_400_000,
    observed_at: 1_700_000_401_000,
  }));

  assert.equal(statements.length, 3);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_dashboard_history_5m')), true);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_total_member_daily')), false);
  assert.equal(statements.some(({ sql }) => sql.includes('DELETE FROM sh_minute_fact_context_v2')), true);
});

test('member changes are persisted immediately with the same direct dashboard point', () => {
  const db = fakeDb();
  minuteFactStatements(db, fact());
  const statements = minuteFactStatements(db, fact({
    minute_at: 1_700_000_400_000,
    observed_at: 1_700_000_401_000,
    total_member_count: 10_001,
  }));

  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_dashboard_history_5m')), true);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_total_member_daily')), true);
});

test('sessionless minute without queue or override data does not create an empty context row', () => {
  const db = fakeDb();
  const statements = minuteFactStatements(db, fact({
    broadcast_session_id: null,
    station_id: null,
    host_id: null,
    broadcast_start_time: null,
  }));

  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_minute_fact_context_v2')), false);
  assert.equal(statements.some(({ sql }) => sql.includes('DELETE FROM sh_minute_fact_context_v2')), true);
});

test('sessionless minute retains real source context when an override value exists', () => {
  const db = fakeDb();
  const statements = minuteFactStatements(db, fact({
    broadcast_session_id: null,
    station_id: 99,
  }));

  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO sh_minute_fact_context_v2')), true);
  assert.equal(statements.some(({ sql }) => sql.includes('DELETE FROM sh_minute_fact_context_v2')), false);
});
