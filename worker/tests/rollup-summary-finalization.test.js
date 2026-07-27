import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  dailyKeysInRange,
  inspectDailySummaryReadiness,
  weeklyKeysIntersectingMonth,
} from '../src/rollup-maintenance.js';

class FakeStatement {
  constructor(db, sql, binds = []) {
    this.db = db;
    this.sql = sql;
    this.binds = binds;
  }

  bind(...binds) {
    return new FakeStatement(this.db, this.sql, binds);
  }

  first() {
    return this.db.first(this.sql, this.binds);
  }

  all() {
    return this.db.all(this.sql, this.binds);
  }
}

class FakeDb {
  constructor(values = {}) {
    this.values = values;
    this.calls = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async first(sql, binds) {
    this.calls.push({ kind: 'first', sql, binds });
    if (sql.includes('sh_minute_fact_rebuild_state')) return this.values.state ?? null;
    if (sql.includes('sh_minute_fact_jobs')) return { count: this.values.jobs ?? 0 };
    if (sql.includes('sh_minute_fact_repairs')) return { count: this.values.repairs ?? 0 };
    if (sql.includes('SELECT 1 AS pending') && sql.includes('sh_channel_snapshots')) {
      return this.values.unscanned ? { pending: 1 } : null;
    }
    return null;
  }

  async all(sql, binds) {
    this.calls.push({ kind: 'all', sql, binds });
    if (sql.includes('FROM sh_channel_snapshots')) {
      return { results: this.values.source || [] };
    }
    if (sql.includes('FROM sh_minute_facts')) {
      return { results: this.values.facts || [] };
    }
    return { results: [] };
  }
}

const period = {
  key: '2026-07-26',
  start: Date.parse('2026-07-26T00:00:00Z'),
  end: Date.parse('2026-07-27T00:00:00Z'),
};

const source = readFileSync(new URL('../src/rollup-maintenance.js', import.meta.url), 'utf8');

test('daily readiness requires every BUDDIES minute to exist in Minute Facts', async () => {
  const buddiesDb = new FakeDb({
    source: [
      { channel_id: 1, minute_at: period.start },
      { channel_id: 1, minute_at: period.start + 60_000 },
    ],
  });
  const minuteDb = new FakeDb({
    state: {
      cursor_observed_at: period.end,
      cursor_snapshot_id: 10,
      pending_json: '[]',
    },
    facts: [
      { channel_id: 1, minute_at: period.start },
      { channel_id: 1, minute_at: period.start + 60_000 },
    ],
  });

  const readiness = await inspectDailySummaryReadiness(buddiesDb, minuteDb, period);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.source_minutes, 2);
  assert.equal(readiness.fact_minutes, 2);
});

test('daily readiness stops before source reads when rebuild candidates remain', async () => {
  const buddiesDb = new FakeDb();
  const minuteDb = new FakeDb({
    state: {
      cursor_observed_at: period.end,
      cursor_snapshot_id: 10,
      pending_json: JSON.stringify([{ minuteAt: period.start }]),
    },
  });

  const readiness = await inspectDailySummaryReadiness(buddiesDb, minuteDb, period);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'rebuild-candidates-pending');
  assert.equal(buddiesDb.calls.length, 0);
});

test('daily readiness reports missing Minute Facts exactly', async () => {
  const buddiesDb = new FakeDb({
    source: [
      { channel_id: 1, minute_at: period.start },
      { channel_id: 1, minute_at: period.start + 60_000 },
    ],
  });
  const minuteDb = new FakeDb({
    state: {
      cursor_observed_at: period.end,
      cursor_snapshot_id: 10,
      pending_json: '[]',
    },
    facts: [{ channel_id: 1, minute_at: period.start }],
  });

  const readiness = await inspectDailySummaryReadiness(buddiesDb, minuteDb, period);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'minute-facts-incomplete');
  assert.equal(readiness.missing_minutes, 1);
});

test('weekly and monthly dependencies enumerate complete lower-level periods', () => {
  assert.deepEqual(dailyKeysInRange('2026-07-27', '2026-08-03'), [
    '2026-07-27',
    '2026-07-28',
    '2026-07-29',
    '2026-07-30',
    '2026-07-31',
    '2026-08-01',
    '2026-08-02',
  ]);
  assert.deepEqual(weeklyKeysIntersectingMonth('2026-08'), [
    '2026-07-27',
    '2026-08-03',
    '2026-08-10',
    '2026-08-17',
    '2026-08-24',
    '2026-08-31',
  ]);
});

test('summary writes are immutable and dependency-gated', () => {
  assert.match(source, /INSERT OR IGNORE INTO \$\{table\}/);
  assert.doesNotMatch(source, /ON CONFLICT\(period_key\) DO UPDATE/);
  assert.match(source, /sh_minute_fact_rebuild_state/);
  assert.match(source, /status IN \('pending','processing','dead'\)/);
  assert.match(source, /status NOT IN \('repaired','preserved'\)/);
  assert.match(source, /reason: 'daily-summaries-incomplete'/);
  assert.match(source, /reason: 'weekly-summaries-incomplete'/);
  assert.match(source, /FINAL_DAILY_FLAGS = '\["minute_facts_final"\]'/);
  assert.match(source, /FINAL_WEEKLY_FLAGS = '\["daily_summary_final"\]'/);
  assert.match(source, /FINAL_MONTHLY_FLAGS = '\["daily_summary_final","weekly_gate_final"\]'/);
});
