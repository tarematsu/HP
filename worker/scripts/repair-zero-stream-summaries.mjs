import { DAY_MS, utcWeeklyRange, utcMonthlyRange } from '../../site/functions/lib/time-buckets.js';

// Legacy imports store the channel's cumulative streams in total_listens.
// Live facts store streams in current_stream_count; total_listens is a different
// counter and must never be used as a fallback for live data.
export const STREAM_VALUE_SQL = `CASE
  WHEN source_code IN (3,4) THEN CASE WHEN reported_total_listens>0 THEN reported_total_listens END
  WHEN reported_current_stream_count>0
    AND reported_current_stream_count IS NOT reported_total_listens
    THEN reported_current_stream_count END`;

const ZERO_PREDICATE = `((source_code IN (3,4) AND reported_total_listens=0)
  OR (source_code NOT IN (3,4) AND reported_current_stream_count=0))`;
const FLAG = 'zero_stream_source_repaired_v1';

function positive(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null;
}

function growth(start, end) {
  return start != null && end != null && end>=start ? end-start : null;
}

function flags(value, missing, borrowed = []) {
  const parsed = JSON.parse(value || '[]');
  if (!Array.isArray(parsed)) throw new Error('summary quality_flags must be an array');
  return JSON.stringify([...new Set([...parsed, FLAG, ...borrowed, ...(missing ? ['zero_stream_source_unavailable'] : [])])]);
}

export async function repairZeroStreamSummaries({ minuteDb, otherDb, now = Date.now(), dayLimit = 30, sourceWriteLimit = 250 }) {
  if (!minuteDb || !otherDb) throw new Error('minuteDb and otherDb are required');
  const today = new Date(now).toISOString().slice(0,10);
  const originalDaily = await otherDb.prepare(`SELECT period_key,stream_start,stream_end,quality_flags FROM sh_daily_summary ORDER BY period_key`).all();
  const originalByDay = new Map((originalDaily.results || []).map(row=>[row.period_key,row]));
  const candidates = await otherDb.prepare(`SELECT period_key,stream_start,stream_end,stream_growth,quality_flags
    FROM sh_daily_summary WHERE period_key<? AND (stream_start=0 OR stream_end=0)
    ORDER BY period_key LIMIT ?`).bind(today,dayLimit).all();
  const report = { daily: [], weekly: [], monthly: [], source_rows: 0, deferred: [] };
  for (const previous of candidates.results || []) {
    const start = Date.parse(`${previous.period_key}T00:00:00Z`);
    if (!Number.isFinite(start)) throw new Error('invalid daily period key');
    // Match the normal rollup's dominant-channel selection. Fetch one bounded
    // day from canonical facts, including source provenance, before mutation.
    const facts = await minuteDb.prepare(`SELECT id,channel_id,minute_at,source_code,
        reported_total_listens,reported_current_stream_count,${STREAM_VALUE_SQL} AS stream_value
      FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
      WHERE minute_at>=? AND minute_at<? ORDER BY minute_at,id`).bind(start,start+DAY_MS).all();
    const channels = new Map();
    for (const row of facts.results || []) {
      const rows = channels.get(row.channel_id) || [];
      rows.push(row);
      channels.set(row.channel_id,rows);
    }
    const selected = [...channels.values()].sort((a,b)=>b.length-a.length
      || b.at(-1).minute_at-a.at(-1).minute_at || a[0].channel_id-b[0].channel_id)[0] || [];
    const zeroRows = selected.filter(row => [3,4].includes(Number(row.source_code))
      ? row.reported_total_listens === 0 : row.reported_current_stream_count === 0);
    const remaining = Math.max(0,sourceWriteLimit-report.source_rows);
    // Bounded, resumable source cleanup. Leave the zero summary as the durable
    // retry marker until all source zeros for this day have been normalized.
    const toFix = zeroRows.slice(0,remaining);
    if (toFix.length) {
      for (let offset=0; offset<toFix.length; offset+=25) {
        await minuteDb.batch(toFix.slice(offset,offset+25).map(row => minuteDb.prepare(`UPDATE sh_minute_facts SET
          reported_total_listens=CASE WHEN source_code IN (3,4) THEN NULLIF(reported_total_listens,0) ELSE reported_total_listens END,
          reported_current_stream_count=CASE WHEN source_code NOT IN (3,4) THEN NULLIF(reported_current_stream_count,0) ELSE reported_current_stream_count END
        WHERE id=? AND ${ZERO_PREDICATE}`).bind(row.id)));
      }
      report.source_rows += toFix.length;
    }
    if (toFix.length<zeroRows.length) {
      report.deferred.push(previous.period_key);
      break;
    }
    const values = selected.map(row=>positive(row.stream_value)).filter(value=>value!=null);
    let streamStart = selected.length ? values[0] ?? null : positive(previous.stream_start);
    let streamEnd = selected.length ? values.at(-1) ?? null : positive(previous.stream_end);
    const previousDay = originalByDay.get(new Date(start-DAY_MS).toISOString().slice(0,10));
    const nextDay = originalByDay.get(new Date(start+DAY_MS).toISOString().slice(0,10));
    const previousEnd = String(previousDay?.quality_flags || '').includes('stream_end_next_day_start')
      ? null : positive(previousDay?.stream_end);
    const nextStart = String(nextDay?.quality_flags || '').includes('stream_start_previous_day_end')
      ? null : positive(nextDay?.stream_start);
    const borrowed = [];
    // Use only immediately adjacent observed daily endpoints from the original
    // snapshot, never recursively propagate an imputed boundary across gaps.
    // Reject a counter reset or a value outside this day's observed range.
    if (previous.stream_start===0 && previousEnd!=null
        && (streamStart==null || previousEnd<=streamStart)
        && (streamEnd==null || previousEnd<=streamEnd)
        && (nextStart==null || previousEnd<=nextStart)) {
      streamStart = previousEnd;
      borrowed.push('stream_start_previous_day_end');
    }
    if (previous.stream_end===0 && nextStart!=null
        && (streamEnd==null || nextStart>=streamEnd)
        && (streamStart==null || nextStart>=streamStart)) {
      streamEnd = nextStart;
      borrowed.push('stream_end_next_day_start');
    }
    const streamGrowth = growth(streamStart,streamEnd);
    await otherDb.prepare(`UPDATE sh_daily_summary SET stream_start=?,stream_end=?,stream_growth=?,quality_flags=?,updated_at=?
      WHERE period_key=? AND stream_start IS ? AND stream_end IS ?`)
      .bind(streamStart,streamEnd,streamGrowth,flags(previous.quality_flags,!selected.length,borrowed),now,
        previous.period_key,previous.stream_start,previous.stream_end).run();
    report.daily.push({ key: previous.period_key, before: [previous.stream_start,previous.stream_end,previous.stream_growth],
      after: [streamStart,streamEnd,streamGrowth], source_samples: selected.length, borrowed });
  }
  // Recompute all existing parent stream fields from the small daily table.
  // This also retries an interrupted run after its daily writes have committed,
  // and repairs parent zeros even when the daily boundary was already valid.
  const daily = await otherDb.prepare(`SELECT period_key,stream_start,stream_end,quality_flags FROM sh_daily_summary ORDER BY period_key`).all();
  for (const [mode,table,toRange] of [
    ['weekly','sh_weekly_summary',utcWeeklyRange], ['monthly','sh_monthly_summary',utcMonthlyRange],
  ]) {
    const parents = await otherDb.prepare(`SELECT period_key,stream_start,stream_end,stream_growth,quality_flags FROM ${table}`).all();
    for (const parent of parents.results || []) {
      const range = toRange(mode==='monthly' ? `${parent.period_key}-01` : parent.period_key);
      const rows = (daily.results || []).filter(row=>row.period_key>=range.startKey && row.period_key<range.endKey);
      if (!rows.length) continue;
      if (parent.stream_start!==0 && parent.stream_end!==0
          && !rows.some(row=>String(row.quality_flags || '').includes(FLAG))) continue;
      const streamStart = rows.map(row=>positive(row.stream_start)).find(value=>value!=null) ?? null;
      const streamEnd = rows.map(row=>positive(row.stream_end)).findLast(value=>value!=null) ?? null;
      const streamGrowth = growth(streamStart,streamEnd);
      if (parent.stream_start===streamStart && parent.stream_end===streamEnd && parent.stream_growth===streamGrowth) continue;
      await otherDb.prepare(`UPDATE ${table} SET stream_start=?,stream_end=?,stream_growth=?,quality_flags=?,updated_at=?
        WHERE period_key=? AND stream_start IS ? AND stream_end IS ? AND stream_growth IS ?`)
        .bind(streamStart,streamEnd,streamGrowth,flags(parent.quality_flags,false),now,parent.period_key,
          parent.stream_start,parent.stream_end,parent.stream_growth).run();
      report[mode].push({ key: parent.period_key, before: [parent.stream_start,parent.stream_end,parent.stream_growth],
        after: [streamStart,streamEnd,streamGrowth] });
    }
  }
  const remaining = await otherDb.prepare(`SELECT COUNT(*) AS count FROM sh_daily_summary
    WHERE period_key<? AND (stream_start=0 OR stream_end=0)`).bind(today).first();
  report.remaining_days = Number(remaining?.count || 0);
  return report;
}
