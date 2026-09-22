import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { loadMaterializedSummary } from '../site/functions/lib/materialized-history.js';
import { applySummaryCompleteness, expectedPeriodBounds } from '../site/functions/lib/period-completeness.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-22T12:00:00Z');

function setup(mode, key) {
  const db = new DatabaseSync(':memory:');
  for (const table of ['daily','weekly','monthly']) db.exec(`CREATE TABLE sh_${table}_summary(
    period_key TEXT PRIMARY KEY,period_start INTEGER,period_end INTEGER,
    sample_count INTEGER,reliable_sample_count INTEGER,listener_avg REAL,
    listener_min INTEGER,listener_max INTEGER,stream_start INTEGER,stream_end INTEGER,
    stream_growth INTEGER,member_start INTEGER,member_end INTEGER,member_growth INTEGER,
    likes_max INTEGER,distinct_tracks INTEGER,primary_host TEXT,quality_score REAL,quality_flags TEXT);`);
  const bounds=expectedPeriodBounds(mode,key);
  const parent=[key,bounds.start,bounds.end-60000,10080,10080,125,100,140,1000,2000,1000,300,310,10,null,1,'host',1,'["weekly_reconciled"]'];
  db.prepare(`INSERT INTO sh_${mode}_summary VALUES(${parent.map(()=>'?').join(',')})`).run(...parent);
  for(let at=bounds.start;at<bounds.end;at+=DAY){
    const day=new Date(at).toISOString().slice(0,10);
    db.prepare(`INSERT INTO sh_daily_summary VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      day,at+60000,at+DAY-60000,1440,1440,125,100,140,1000,2000,1000,300,310,10,null,null,'host',1,'["daily_reconciled"]');
  }
  const adapter={prepare(sql){let binds=[];return {bind(...values){binds=values;return this;},async all(){return {results:db.prepare(sql).all(...binds)};},async run(){return db.prepare(sql).run(...binds);}};}};
  const get=()=>loadMaterializedSummary({OTHER_DB:adapter},mode,key,key,NOW);
  return {db,bounds,get};
}

for(const [mode,key] of [['weekly','2026-09-07'],['monthly','2026-08']]){
  test(`${mode} keeps metrics when every UTC day has sufficient observations`,async()=>{
    const f=setup(mode,key);const {rows}=await f.get();
    assert.equal(rows[0].listener_avg,125);
    assert.equal(rows[0].stream_growth,1000);
    assert.equal(rows[0].period_complete,true);
  });
  test(`${mode} masks metrics when a middle UTC day is absent despite parent endpoints`,async()=>{
    const f=setup(mode,key);
    f.db.prepare('DELETE FROM sh_daily_summary WHERE period_key=?').run(new Date(f.bounds.start+3*DAY).toISOString().slice(0,10));
    const {rows}=await f.get();const row=rows[0];
    assert.equal(row.period_complete,false);
    for(const field of ['listener_avg','listener_min','listener_max','stream_start','stream_end','stream_growth','member_start','member_end','member_growth']){
      assert.equal(row[field],null,field);
    }
    assert.ok(row.exclusion_reasons.includes('missing_daily_coverage'));
  });
  test(`${mode} masks a sparse or broken daily stream while preserving raw record count`,async()=>{
    const f=setup(mode,key);
    const day=new Date(f.bounds.start+2*DAY).toISOString().slice(0,10);
    f.db.prepare('UPDATE sh_daily_summary SET sample_count=24,reliable_sample_count=24 WHERE period_key=?').run(day);
    let row=(await f.get()).rows[0];
    assert.equal(row.listener_avg,null);
    assert.equal(row.sample_count,10080);
    assert.ok(row.exclusion_reasons.includes('insufficient_daily_samples'));
    f.db.prepare('UPDATE sh_daily_summary SET sample_count=1440,reliable_sample_count=1440,stream_start=NULL WHERE period_key=?').run(day);
    row=(await f.get()).rows[0];
    assert.equal(row.stream_growth,null);
    assert.ok(row.exclusion_reasons.includes('missing_daily_stream_boundary'));
  });
  test(`${mode} masks a missing parent stream boundary`,async()=>{
    const f=setup(mode,key);
    f.db.prepare(`UPDATE sh_${mode}_summary SET stream_start=NULL WHERE period_key=?`).run(key);
    const row=(await f.get()).rows[0];
    assert.equal(row.period_complete,false);
    for(const field of ['listener_avg','stream_start','stream_end','stream_growth']){
      assert.equal(row[field],null,field);
    }
  });
}

test('trusted archived email recap remains independent of daily minute coverage',()=>{
  const bounds=expectedPeriodBounds('weekly','2026-06-22');
  const row={period_key:'2026-06-22',period_start:bounds.start,period_end:bounds.end,
    listener_avg:120,stream_start:100,stream_end:200,stream_growth:100,
    quality_flags:'["stationhead_email_recap"]'};
  const result=applySummaryCompleteness([row],'weekly',NOW,[]).rows[0];
  assert.equal(result.stream_growth,100);
  assert.equal(result.listener_avg,120);
});
