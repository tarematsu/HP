import { planStationheadPlaybackDaily } from '../src/stationhead-playback-store.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
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

function sqliteD1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return { async all() { return { results: statement.all(...args) }; } };
        },
      };
    },
  };
}

test('Buddies gap recovery resolves station and broadcast context from the sparse context view', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE sh_minute_facts (
        id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, minute_at INTEGER NOT NULL,
        observed_at INTEGER NOT NULL, broadcast_session_id INTEGER, is_broadcasting INTEGER,
        listener_count INTEGER, online_member_count INTEGER, total_member_count INTEGER,
        guest_count INTEGER, reported_total_listens INTEGER, reported_current_stream_count INTEGER
      );
      CREATE TABLE sh_broadcast_sessions (
        id INTEGER PRIMARY KEY, station_id INTEGER, broadcast_start_time INTEGER
      );
      CREATE TABLE sh_minute_fact_context_v2 (
        fact_id INTEGER PRIMARY KEY, station_id_override INTEGER, broadcast_start_time_override INTEGER
      );
      CREATE VIEW sh_minute_fact_context AS
        SELECT v.fact_id,
          COALESCE(v.station_id_override,s.station_id) AS station_id,
          COALESCE(v.broadcast_start_time_override,s.broadcast_start_time) AS broadcast_start_time
        FROM sh_minute_fact_context_v2 v
        LEFT JOIN sh_minute_facts f ON f.id=v.fact_id
        LEFT JOIN sh_broadcast_sessions s ON s.id=f.broadcast_session_id;
      INSERT INTO sh_broadcast_sessions VALUES(7,3953999,1200);
      INSERT INTO sh_minute_facts VALUES
        (1,318,100,100,7,1,10,20,30,40,50,60),
        (2,318,200,200,7,1,11,21,31,41,51,61),
        (3,318,300,300,7,1,12,22,32,42,52,62),
        (4,318,250,250,7,1,13,23,33,43,53,63);
      INSERT INTO sh_minute_fact_context_v2 VALUES
        (2,NULL,NULL),(4,1234,1500);
    `);

    const rows = await loadStationheadMinuteFactGapRows(sqliteD1(sqlite), 'buddies', 318, 100, 300);
    assert.deepEqual(rows.map((row) => [
      row.channel_id, row.station_id, row.minute_at, row.broadcast_start_time,
    ]), [
      [318, 3953999, 200, 1200],
      [318, 1234, 250, 1500],
    ]);
  } finally {
    sqlite.close();
  }
});

for (const [source, cursor, uniqueColumn] of [
  ['buddies', 'minute_at', 'broadcast_start_time'],
  ['ohisama', 'observed_at', 'reported_current_stream_count'],
]) {
  test(`${source} recovery reads only scoped chronological D1 facts`, async () => {
    const rows = [{ channel_id: 2, observed_at: 123 }];
    const db = fakeDb({ results: rows });
    assert.equal(await loadStationheadMinuteFactGapRows(db, source, 2, 100, 200), rows);
    assert.deepEqual(db.calls[0].args, [2, 100, 200]);
    const scopedWhere = source === 'buddies'
      ? /WHERE facts\.channel_id=\? AND facts\.minute_at>\? AND facts\.minute_at<\?/
      : new RegExp(`WHERE channel_id=\\? AND ${cursor}>\\? AND ${cursor}<\\?`);
    const chronologicalOrder = source === 'buddies'
      ? /ORDER BY facts\.minute_at ASC,facts\.id ASC/
      : new RegExp(`ORDER BY ${cursor} ASC,id ASC`);
    assert.match(db.calls[0].sql, scopedWhere);
    assert.match(db.calls[0].sql, chronologicalOrder);
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

test('recovery retains every completed playback day and advances the hot day to now', () => {
  const db = fakeDb();
  const tracks = ['2026-10-06', '2026-10-07', '2026-10-08'].map((day, index) => ({
    track_id: index + 1, event_key: `event:${index}`, expected_start_at: Date.parse(`${day}T12:00:00Z`),
  }));
  const result = planStationheadPlaybackDaily(db, 99, null, tracks, Date.parse('2026-10-10T00:00:00Z'), 'Ohisama');
  assert.deepEqual(result.completedDays.map((row) => row.period_key), ['2026-10-06', '2026-10-07', '2026-10-08']);
  assert.deepEqual(result.completedDays.map((row) => row.total_plays), [1, 1, 1]);
  assert.equal(result.daily.period_key, '2026-10-10');
});

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

for (const label of ['Buddies', 'Ohisama']) {
  test(`${label} daily plan preserves midnight plays and flushes the completed day`, () => {
    const db = fakeDb();
    const midnight = Date.parse('2026-10-02T00:00:00Z');
    const tracks = [-1, 1].map((offset, index) => ({
      track_id: index + 1, track_key: `track:${index}`, event_key: `event:${index}`,
      expected_start_at: midnight + offset,
    }));
    const result = planStationheadPlaybackDaily(db, 99, null, tracks, midnight + 10, label);
    assert.equal(result.completedDay.period_key, '2026-10-01');
    assert.equal(result.completedDay.total_plays, 1);
    assert.equal(result.daily.period_key, '2026-10-02');
    assert.equal(result.daily.total_plays, 1);
    const plays = db.calls.filter(call => call.sql.includes('INSERT OR IGNORE INTO sh_track_plays'));
    assert.deepEqual(plays.map(call => call.args.slice(1, 4)), [
      [midnight - 1, '2026-10-01', 99], [midnight + 1, '2026-10-02', 99],
    ]);
    const idle = planStationheadPlaybackDaily(db, 99, result.daily, [], midnight + 86400000, label);
    assert.equal(idle.completedDay.total_plays, 1);
    assert.equal(idle.daily.period_key, '2026-10-03');
    assert.equal(idle.daily.total_plays, 0);
    assert.equal(idle.statements.length, 1);
  });
}

