import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { upsertStationheadPeriodSummary } from '../src/stationhead-period-summary-store.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const schema = `(period_key TEXT PRIMARY KEY,period_start INTEGER,period_end INTEGER,sample_count INTEGER,
    listener_avg REAL,listener_min INTEGER,listener_max INTEGER,stream_start INTEGER,stream_end INTEGER,
    stream_growth INTEGER,member_start INTEGER,member_end INTEGER,member_growth INTEGER,updated_at INTEGER)`;
  sqlite.exec(`CREATE TABLE sh_daily_summary ${schema}; CREATE TABLE sh_weekly_summary ${schema};`);
  let writes = 0;
  const db = { prepare(sql) {
    return { bind(...params) {
      return { async run() {
        const changed = Number(sqlite.prepare(sql).run(...params).changes);
        writes += changed;
        return { meta: { changes: changed } };
      } };
    } };
  } };
  const row = (table) => ({ ...sqlite.prepare(`SELECT * FROM ${table}`).get() });
  return { sqlite, db, row, written: () => writes };
}

const sample = Object.freeze({
  period_key: '2026-10-13',period_start:1,period_end:100,sample_count:25,
  listener_avg:14.5,listener_min:10,listener_max:18,stream_start:100,stream_end:150,
  stream_growth:50,member_start:50,member_end:51,member_growth:1,updated_at:150,
});

for(const [period, table] of [['daily','sh_daily_summary'],['weekly','sh_weekly_summary']]){
  test(`${period} summary skips identical reruns including a later timestamp`,async()=>{
    const { sqlite,db,row,written }=fixture();
    try {
      await upsertStationheadPeriodSummary(db,period,sample);
      assert.equal(written(),1);
      await upsertStationheadPeriodSummary(db,period,{...sample,updated_at:151});
      await upsertStationheadPeriodSummary(db,period,{...sample,updated_at:152});
      assert.equal(written(),1);
      assert.equal(row(table).updated_at,150);
      await upsertStationheadPeriodSummary(db,period,{...sample,listener_avg:15,updated_at:153});
      assert.equal(written(),2);
      assert.equal(row(table).listener_avg,15);
      assert.equal(row(table).updated_at,153);
      await upsertStationheadPeriodSummary(db,period,{...sample,listener_avg:14.5,updated_at:152});
      assert.equal(written(),2,'older observation cannot revert changed metrics');
      await upsertStationheadPeriodSummary(db,period,{...sample,member_growth:null,updated_at:154});
      assert.equal(written(),3,'null-safe comparison recognizes null transitions');
      assert.equal(row(table).member_growth,null);
    } finally { sqlite.close(); }
  });
}
