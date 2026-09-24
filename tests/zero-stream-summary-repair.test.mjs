import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { repairZeroStreamSummaries } from '../worker/scripts/repair-zero-stream-summaries.mjs';

function adapter(db) {
  return { prepare(sql) {
    let args=[];
    return { bind(...values) { args=values; return this; },
      async all() { return {results:db.prepare(sql).all(...args)}; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { return db.prepare(sql).run(...args); } };
  }, async batch(statements) { db.exec('BEGIN'); try { const result=[]; for (const s of statements) result.push(await s.run()); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } } };
}
function fixture() {
  const minute=new DatabaseSync(':memory:');
  const other=new DatabaseSync(':memory:');
  minute.exec(`CREATE TABLE sh_minute_facts(id INTEGER PRIMARY KEY,channel_id INTEGER,minute_at INTEGER,source_code INTEGER,reported_total_listens INTEGER,reported_current_stream_count INTEGER);
    CREATE INDEX idx_sh_minute_facts_time ON sh_minute_facts(minute_at);`);
  for (const table of ['daily','weekly','monthly']) other.exec(`CREATE TABLE sh_${table}_summary(period_key TEXT PRIMARY KEY,stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1,listener_max INTEGER DEFAULT 999);`);
  const day=(key,start,end)=>other.prepare('INSERT INTO sh_daily_summary(period_key,stream_start,stream_end,stream_growth) VALUES(?,?,?,?)').run(key,start,end,start!=null&&end>=start?end-start:null);
  const fact=(key,offset,total,current=null,source=3,channel=318)=>minute.prepare('INSERT INTO sh_minute_facts(channel_id,minute_at,source_code,reported_total_listens,reported_current_stream_count) VALUES(?,?,?,?,?)').run(channel,Date.parse(key+'T00:00:00Z')+offset*60000,source,total,current);
  const run=(options={})=>repairZeroStreamSummaries({minuteDb:adapter(minute),otherDb:adapter(other),now:Date.parse('2026-09-23'),...options});
  const get=key=>other.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get(key);
  return {minute,other,day,fact,run,get};
}

test('normalizes legacy source zeros, borrows adjacent observations and rebuilds weekly only',async()=>{
  const f=fixture();
  f.day('2024-07-09',800,850); f.day('2024-07-10',0,0); f.day('2024-07-11',1000,1100);
  f.fact('2024-07-10',0,0); f.fact('2024-07-10',10,900); f.fact('2024-07-10',20,950); f.fact('2024-07-10',30,0);
  f.other.prepare('INSERT INTO sh_weekly_summary(period_key,stream_start,stream_end,stream_growth) VALUES(?,0,1100,1100)').run('2024-07-08');
  f.other.prepare('INSERT INTO sh_monthly_summary(period_key,stream_start,stream_end,stream_growth) VALUES(?,0,1100,1100)').run('2024-07');
  const result=await f.run();
  assert.deepEqual([f.get('2024-07-10').stream_start,f.get('2024-07-10').stream_end,f.get('2024-07-10').stream_growth],[850,1000,150]);
  assert.equal(f.get('2024-07-10').listener_max,999);
  assert.match(f.get('2024-07-10').quality_flags,/stream_end_next_day_start/);
  assert.equal(f.minute.prepare('SELECT COUNT(*) AS n FROM sh_minute_facts WHERE reported_total_listens=0').get().n,0);
  assert.equal(result.weekly.length,1);
  assert.equal('monthly' in result,false);
  assert.equal(f.other.prepare('SELECT stream_growth FROM sh_weekly_summary').get().stream_growth,300);
  assert.equal(f.other.prepare('SELECT stream_growth FROM sh_monthly_summary').get().stream_growth,1100);
  assert.equal(result.remaining_days,0);
  const again=await f.run();
  assert.equal(again.source_rows,0); assert.equal(again.daily.length+again.weekly.length,0);
  assert.equal('monthly' in again,false);
});

test('rejects reversed neighbor counters and uses same-day positive evidence',async()=>{
  const f=fixture(); f.day('2024-07-09',1500,1600); f.day('2024-07-10',0,0); f.day('2024-07-11',800,900);
  f.fact('2024-07-10',0,0); f.fact('2024-07-10',10,900); f.fact('2024-07-10',20,950);
  await f.run(); assert.equal(f.get('2024-07-10').stream_start,900); assert.equal(f.get('2024-07-10').stream_end,950);
});

test('unavailable source stays missing; adjacent imputations never propagate through missing days',async()=>{
  const f=fixture(); f.day('2024-07-09',100,200); f.day('2024-07-10',0,0); f.day('2024-07-11',0,0); f.day('2024-07-12',300,400);
  await f.run(); assert.equal(f.get('2024-07-10').stream_start,200); assert.equal(f.get('2024-07-10').stream_end,null);
  assert.equal(f.get('2024-07-11').stream_start,null); assert.equal(f.get('2024-07-11').stream_end,300);
  assert.equal(f.get('2024-07-11').stream_growth,null);
});

test('live streams never fall back to total_listens and other channels do not contaminate endpoints',async()=>{
  const f=fixture(); f.day('2026-09-20',0,0);
  f.fact('2026-09-20',0,99999,0,1); f.fact('2026-09-20',10,99999,120,1); f.fact('2026-09-20',20,99999,150,1);
  f.fact('2026-09-20',30,500000,500000,1,42);
  await f.run(); assert.equal(f.get('2026-09-20').stream_start,120); assert.equal(f.get('2026-09-20').stream_end,150);
  assert.equal(f.minute.prepare('SELECT reported_total_listens FROM sh_minute_facts WHERE id=1').get().reported_total_listens,99999);
});

test('source write budget leaves durable retry candidate and finishes next run',async()=>{
  const f=fixture(); f.day('2024-07-10',0,0); f.fact('2024-07-10',0,0); f.fact('2024-07-10',1,0); f.fact('2024-07-10',2,120);
  const first=await f.run({sourceWriteLimit:1}); assert.equal(first.source_rows,1); assert.equal(first.remaining_days,1);
  const second=await f.run({sourceWriteLimit:1}); assert.equal(second.remaining_days,0); assert.equal(f.get('2024-07-10').stream_start,120);
});

test('a new batch does not borrow previously imputed adjacent boundaries',async()=>{
  const f=fixture(); f.day('2024-07-09',100,0); f.day('2024-07-10',0,0);
  f.other.prepare("UPDATE sh_daily_summary SET stream_end=200,quality_flags='[\"stream_end_next_day_start\"]' WHERE period_key='2024-07-09'").run();
  await f.run(); assert.equal(f.get('2024-07-10').stream_start,null); assert.equal(f.get('2024-07-10').stream_end,null);
});
