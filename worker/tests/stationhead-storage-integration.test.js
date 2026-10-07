import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStationheadMinuteFactGapRows } from '../src/stationhead-minute-facts-reader.js';
import { upsertStationheadPeriodSummary } from '../src/stationhead-period-summary-store.js';
import { publishStationheadReadModel } from '../src/stationhead-read-model-state.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

function fakeDb(result = { results: [] }) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async all() { return result; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
}

for (const [source, cursor, uniqueColumn] of [
  ['buddies', 'minute_at', 'broadcast_start_time'],
  ['ohisama', 'observed_at', 'reported_current_stream_count'],
]) {
  test(`${source} recovery reads only scoped chronological D1 facts`, async () => {
    const rows = [{ channel_id: 2, observed_at: 123 }];
    const db = fakeDb({ results: rows });
    assert.equal(await loadStationheadMinuteFactGapRows(db, source, 2, 100, 200), rows);
    assert.deepEqual(db.calls[0].args, [2, 100, 200]);
    assert.match(db.calls[0].sql, new RegExp(`WHERE channel_id=\\? AND ${cursor}>\\? AND ${cursor}<\\?`));
    assert.match(db.calls[0].sql, new RegExp(`ORDER BY ${cursor} ASC,id ASC`));
    assert.ok(db.calls[0].sql.includes(uniqueColumn));
    assert.equal(db.calls.length, 1);
  });
}

test('recovery D1 errors propagate; unsupported sources never query', async () => {
  const db = fakeDb();
  await assert.rejects(loadStationheadMinuteFactGapRows(db, 'unknown', 1, 0, 1), /unsupported/);
  assert.equal(db.calls.length, 0);
  await assert.rejects(loadStationheadMinuteFactGapRows(null, 'ohisama', 1, 0, 1), /binding missing/);
  const broken = { prepare() { throw new Error('unavailable'); } };
  await assert.rejects(loadStationheadMinuteFactGapRows(broken, 'buddies', 1, 0, 1), /unavailable/);
});

const summary = {
  period_key: '2026-10-01', period_start: 100, period_end: 200, sample_count: 2,
  listener_avg: 1.5, listener_min: 1, listener_max: 2,
  stream_start: 5, stream_end: 8, stream_growth: 3,
  member_start: 10, member_end: 12, member_growth: 2, updated_at: 150,
};

for (const [period, table, condition] of [
  ['daily', 'sh_daily_summary', '>'],
  ['weekly', 'sh_weekly_summary', '>='],
]) {
  test(`${period} summary preserves existing monotonic D1 upsert semantics`, async () => {
    const db = fakeDb();
    assert.equal(await upsertStationheadPeriodSummary(db, period, summary), true);
    const { sql, args } = db.calls[0];
    assert.match(sql, new RegExp(`INSERT INTO ${table}\\(`));
    assert.ok(sql.includes(`excluded.updated_at${condition}${table}.updated_at`));
    assert.equal(args.length, 14);
    assert.equal(args[0], summary.period_key);
    assert.equal(args.at(-1), 150);
    assert.equal(db.calls.length, 1);
    assert.equal(await upsertStationheadPeriodSummary(db, period, {}), false);
    assert.equal(db.calls.length, 1);
    const fallback = { ...summary, updated_at: null };
    assert.equal(await upsertStationheadPeriodSummary(db, period, fallback), true);
    assert.equal(db.calls[1].args.at(-1), 200);
  });
}

test('unknown period cannot form dynamic SQL', async () => {
  const db = fakeDb();
  await assert.rejects(upsertStationheadPeriodSummary(db, 'monthly', summary), /unsupported/);
  assert.equal(db.calls.length, 0);
});

test('source-scoped R2 publication retains model keys, cadence and one-object format', async () => {
  const objects = [];
  const r2 = { async put(key, body, metadata) { objects.push({ key, body, metadata }); } };
  for (const [source, key, cadence] of [['buddies', 'dashboard', 300], ['ohisama', 'hinata', 300]]) {
    const payload = { ok: true, source };
    await publishStationheadReadModel(r2, source, payload, 12345, {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    const saved = objects.at(-1);
    assert.equal(saved.key, pagesR2ResponseKey(key));
    assert.deepEqual(JSON.parse(saved.body), payload);
    assert.equal(saved.metadata.customMetadata.model_key, key);
    assert.equal(saved.metadata.customMetadata.cadence_seconds, String(cadence));
    assert.equal(saved.metadata.customMetadata.updated_at, '12345');
  }
  assert.equal(objects.length, 2);
  await assert.rejects(publishStationheadReadModel(r2, 'invalid', {}, 1), /unsupported/);
  assert.equal(objects.length, 2);
});
