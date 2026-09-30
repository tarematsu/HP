import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const LOW_LISTENER_MAX = 15;
const PROTECTED_REPAIR_PRIORITY = 200;
const MAX_INTERPOLATION_DISTANCE_MS = 30 * 60_000;
const REPAIR_FLAG = 'listener_anomaly_repaired';
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');

function integer(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dayStart(dayKey) {
  return Date.parse(`${dayKey}T00:00:00Z`);
}

function currentUtcDay(now) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

function threeCalendarMonthsAgoDay(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 3, date.getUTCDate());
}

function mondayStart(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  return timestamp - ((day + 6) % 7) * DAY_MS;
}

function monthStart(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonthStart(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function monthKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function appendFlag(value, flag = REPAIR_FLAG) {
  const flags = new Set();
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        for (const item of parsed) if (item) flags.add(String(item));
      } else {
        flags.add(value);
      }
    } catch {
      for (const item of value.split(',')) if (item.trim()) flags.add(item.trim());
    }
  }
  flags.add(flag);
  return JSON.stringify([...flags]);
}

function correctionFor(rows, index) {
  const row = rows[index];
  const current = integer(row?.listener_count);
  if (current == null || current > LOW_LISTENER_MAX) return null;

  let previous = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const value = integer(rows[i]?.listener_count);
    if (value != null && value > LOW_LISTENER_MAX) {
      previous = rows[i];
      break;
    }
  }
  let next = null;
  for (let i = index + 1; i < rows.length; i += 1) {
    const value = integer(rows[i]?.listener_count);
    if (value != null && value > LOW_LISTENER_MAX) {
      next = rows[i];
      break;
    }
  }

  const at = integer(row.minute_at);
  const previousAt = integer(previous?.minute_at);
  const nextAt = integer(next?.minute_at);
  const previousValue = integer(previous?.listener_count);
  const nextValue = integer(next?.listener_count);
  if (at != null && previousAt != null && nextAt != null
      && previousValue != null && nextValue != null
      && at - previousAt <= MAX_INTERPOLATION_DISTANCE_MS
      && nextAt - at <= MAX_INTERPOLATION_DISTANCE_MS
      && nextAt > previousAt) {
    const ratio = (at - previousAt) / (nextAt - previousAt);
    const interpolated = Math.max(
      LOW_LISTENER_MAX + 1,
      Math.round(previousValue + (nextValue - previousValue) * ratio),
    );
    return { value: interpolated, method: 'interpolated', previousValue, nextValue };
  }
  return { value: null, method: 'excluded', previousValue, nextValue };
}

async function candidateDayChannels(minuteDb, from, to) {
  const result = await minuteDb.prepare(`SELECT
      channel_id,
      CAST(minute_at/${DAY_MS} AS INTEGER)*${DAY_MS} AS day_at,
      MIN(listener_count) AS listener_min,
      COUNT(*) AS low_sample_count
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE minute_at>=? AND minute_at<?
      AND listener_count IS NOT NULL AND listener_count<=?
    GROUP BY channel_id,CAST(minute_at/${DAY_MS} AS INTEGER)
    ORDER BY day_at ASC,channel_id ASC`).bind(from, to, LOW_LISTENER_MAX).all();
  return result.results || [];
}

async function dominantChannel(minuteDb, start, end) {
  return minuteDb.prepare(`SELECT channel_id,COUNT(*) AS sample_count
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE minute_at>=? AND minute_at<?
    GROUP BY channel_id
    ORDER BY sample_count DESC,MAX(minute_at) DESC,channel_id ASC
    LIMIT 1`).bind(start, end).first();
}

async function dayRows(minuteDb, channelId, start, end) {
  const result = await minuteDb.prepare(`SELECT id,channel_id,minute_at,listener_count,source_priority,source_record_id
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE channel_id=? AND minute_at>=? AND minute_at<?
    ORDER BY minute_at ASC,id ASC`).bind(channelId, start, end).all();
  return result.results || [];
}

async function protectCorrection(minuteDb, row, correction, dayKey) {
  const marker = `listener-repair:v1:${dayKey}:${row.minute_at}:${correction.method}`;
  const result = await minuteDb.prepare(`UPDATE sh_minute_facts
    SET listener_count=?,
        source_priority=CASE WHEN COALESCE(source_priority,0)<? THEN ? ELSE source_priority END,
        source_record_id=?
    WHERE id=? AND listener_count IS ?`).bind(
    correction.value,
    PROTECTED_REPAIR_PRIORITY,
    PROTECTED_REPAIR_PRIORITY,
    marker,
    row.id,
    row.listener_count,
  ).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

async function recomputeDaily(otherDb, minuteDb, day, channelId, start, end, now) {
  const aggregate = await minuteDb.prepare(`SELECT
      MIN(minute_at) AS period_start,MAX(minute_at) AS period_end,
      COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
      AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,
      MAX(listener_count) AS listener_max
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE channel_id=? AND minute_at>=? AND minute_at<?`).bind(channelId, start, end).first();
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) return null;
  const existing = await otherDb.prepare(`SELECT quality_flags FROM sh_daily_summary
    WHERE period_key=? LIMIT 1`).bind(day).first();
  if (!existing) return aggregate;
  await otherDb.prepare(`UPDATE sh_daily_summary SET
      period_start=?,period_end=?,sample_count=?,reliable_sample_count=?,
      listener_avg=?,listener_min=?,listener_max=?,quality_flags=?,updated_at=?
    WHERE period_key=?`).bind(
    finite(aggregate.period_start), finite(aggregate.period_end),
    Number(aggregate.sample_count || 0), Number(aggregate.reliable_sample_count || 0),
    finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),
    appendFlag(existing.quality_flags), now, day,
  ).run();
  return aggregate;
}

async function refreshAggregate(otherDb, table, key, startKey, endKey, now) {
  const aggregate = await otherDb.prepare(`SELECT
      SUM(sample_count) AS sample_count,SUM(reliable_sample_count) AS reliable_sample_count,
      CASE WHEN SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END)>0
        THEN SUM(listener_avg*reliable_sample_count)
          /SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END) END AS listener_avg,
      MIN(listener_min) AS listener_min,MAX(listener_max) AS listener_max
    FROM sh_daily_summary WHERE period_key>=? AND period_key<?`).bind(startKey, endKey).first();
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) return false;
  const existing = await otherDb.prepare(`SELECT quality_flags FROM ${table}
    WHERE period_key=? LIMIT 1`).bind(key).first();
  if (!existing) return false;
  await otherDb.prepare(`UPDATE ${table} SET
      sample_count=?,reliable_sample_count=?,listener_avg=?,listener_min=?,listener_max=?,
      quality_flags=?,updated_at=? WHERE period_key=?`).bind(
    Number(aggregate.sample_count || 0), Number(aggregate.reliable_sample_count || 0),
    finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),
    appendFlag(existing.quality_flags), now, key,
  ).run();
  return true;
}

export async function repairLowListenerAnomalies({ minuteDb, otherDb, now = Date.now() } = {}) {
  if (!minuteDb || !otherDb) throw new Error('minuteDb and otherDb are required');
  const today = currentUtcDay(now);
  const from = threeCalendarMonthsAgoDay(now);
  const fromKey = isoDay(from);
  const toKey = isoDay(today);
  const candidates = await candidateDayChannels(minuteDb, from, today);
  const perDay = new Map();

  for (const candidate of candidates) {
    const start = integer(candidate.day_at);
    const channelId = integer(candidate.channel_id);
    if (start == null || channelId == null) continue;
    const day = isoDay(start);
    const end = start + DAY_MS;
    const report = perDay.get(day) || {
      day,
      before_min: finite(candidate.listener_min),
      corrected: 0,
      interpolated: 0,
      excluded: 0,
      channels: [],
    };
    report.before_min = report.before_min == null
      ? finite(candidate.listener_min)
      : Math.min(report.before_min, finite(candidate.listener_min) ?? report.before_min);

    const rows = await dayRows(minuteDb, channelId, start, end);
    let corrected = 0;
    let interpolated = 0;
    let excluded = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const correction = correctionFor(rows, index);
      if (!correction) continue;
      if (await protectCorrection(minuteDb, rows[index], correction, day)) {
        corrected += 1;
        if (correction.method === 'interpolated') interpolated += 1;
        else excluded += 1;
      }
    }
    report.corrected += corrected;
    report.interpolated += interpolated;
    report.excluded += excluded;
    report.channels.push({
      channel_id: channelId,
      before_min: finite(candidate.listener_min),
      low_samples: Number(candidate.low_sample_count || 0),
      corrected,
      interpolated,
      excluded,
    });
    perDay.set(day, report);
  }

  const repairedDays = [];
  const affectedWeeks = new Map();
  const affectedMonths = new Map();
  for (const [day, report] of perDay) {
    const start = dayStart(day);
    const end = start + DAY_MS;
    const dominant = await dominantChannel(minuteDb, start, end);
    const dominantChannelId = integer(dominant?.channel_id);
    const aggregate = dominantChannelId == null
      ? null
      : await recomputeDaily(otherDb, minuteDb, day, dominantChannelId, start, end, now);
    report.summary_channel_id = dominantChannelId;
    report.after_min = finite(aggregate?.listener_min);
    repairedDays.push(report);

    const weekStart = mondayStart(start);
    const monthAt = monthStart(start);
    affectedWeeks.set(isoDay(weekStart), { start: weekStart, end: weekStart + 7 * DAY_MS });
    affectedMonths.set(monthKey(monthAt), { start: monthAt, end: nextMonthStart(monthAt) });
  }

  const refreshedWeeks = [];
  for (const [key, range] of affectedWeeks) {
    if (await refreshAggregate(otherDb, 'sh_weekly_summary', key, isoDay(range.start), isoDay(range.end), now)) {
      refreshedWeeks.push(key);
    }
  }
  const refreshedMonths = [];
  for (const [key, range] of affectedMonths) {
    if (await refreshAggregate(otherDb, 'sh_monthly_summary', key, isoDay(range.start), isoDay(range.end), now)) {
      refreshedMonths.push(key);
    }
  }

  const remaining = await candidateDayChannels(minuteDb, from, today);
  return {
    ok: remaining.length === 0,
    from: fromKey,
    to_exclusive: toKey,
    protected_priority: PROTECTED_REPAIR_PRIORITY,
    candidate_day_channels: candidates.length,
    candidate_days: perDay.size,
    repaired_days: repairedDays,
    refreshed_weeks: refreshedWeeks,
    refreshed_months: refreshedMonths,
    remaining_anomalies: remaining.map((row) => ({
      day: isoDay(Number(row.day_at)),
      channel_id: integer(row.channel_id),
      listener_min: finite(row.listener_min),
      low_samples: Number(row.low_sample_count || 0),
    })),
  };
}

async function main() {
  const minuteDb = createWranglerRemoteD1({
    database: process.env.FACTS_DATABASE_NAME || 'stationhead-minute',
    cwd: workerRoot,
    wranglerScript,
  });
  const otherDb = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await repairLowListenerAnomalies({ minuteDb, otherDb });
  console.log(JSON.stringify({ event: 'low_listener_anomaly_repair', ...result }));
  if (!result.ok) process.exitCode = 2;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
