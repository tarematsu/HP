import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { utcWeeklyRange } from '../../site/functions/lib/time-buckets.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_MAX_BOUNDARY_GAP_MS = 12 * HOUR_MS;
const FLAG = 'stream_boundary_interpolated_v1';
const KNOWN_RANGES = [
  { start: '2024-06-28', end: '2024-07-13', reason: 'missing_utc_day_boundary_samples' },
];
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dayStart(key) {
  return Date.parse(`${key}T00:00:00Z`);
}

function addDays(key, amount) {
  return dayKey(dayStart(key) + amount * DAY_MS);
}

function parseFlags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addFlag(value) {
  return JSON.stringify([...new Set([...parseFlags(value), FLAG])]);
}

function growth(start, end) {
  return start != null && end != null && end >= start ? end - start : null;
}

function estimateBoundary(previous, current, boundaryKey, maxGapMs) {
  if (!previous || !current) return { ok: false, reason: 'missing_adjacent_summary' };
  const boundaryAt = dayStart(boundaryKey);
  const beforeAt = finite(previous.period_end);
  const afterAt = finite(current.period_start);
  const beforeValue = finite(previous.stream_end);
  const afterValue = finite(current.stream_start);
  if (beforeAt == null || afterAt == null || beforeValue == null || afterValue == null) {
    return { ok: false, reason: 'missing_boundary_evidence' };
  }
  if (beforeAt > boundaryAt || afterAt < boundaryAt || afterAt < beforeAt) {
    return { ok: false, reason: 'invalid_boundary_order' };
  }
  if (afterValue < beforeValue) return { ok: false, reason: 'stream_counter_decrease' };

  const gapMs = afterAt - beforeAt;
  if (gapMs > maxGapMs) return { ok: false, reason: 'boundary_gap_too_wide', gap_ms: gapMs };

  let value;
  if (beforeAt === boundaryAt) value = beforeValue;
  else if (afterAt === boundaryAt) value = afterValue;
  else {
    if (gapMs <= 0) return { ok: false, reason: 'zero_boundary_gap' };
    const ratio = (boundaryAt - beforeAt) / gapMs;
    value = Math.round(beforeValue + (afterValue - beforeValue) * ratio);
  }

  return {
    ok: true,
    key: boundaryKey,
    at: boundaryAt,
    value,
    before: { at: beforeAt, value: beforeValue },
    after: { at: afterAt, value: afterValue },
    gap_ms: gapMs,
  };
}

async function loadDailyRows(otherDb, fromKey, toKey) {
  const result = await otherDb.prepare(`SELECT
      period_key,period_start,period_end,stream_start,stream_end,stream_growth,quality_flags
    FROM sh_daily_summary
    WHERE period_key>=? AND period_key<=?
    ORDER BY period_key ASC`).bind(fromKey, toKey).all();
  return result.results || [];
}

async function repairParentPeriods(otherDb, repairedDays, now) {
  const report = { weekly: [] };
  const ranges = new Map();
  for (const key of repairedDays) {
    const range = utcWeeklyRange(key);
    ranges.set(range.key, range);
  }
  for (const range of ranges.values()) {
    const [first, last, parent] = await Promise.all([
      otherDb.prepare(`SELECT period_key,stream_start FROM sh_daily_summary
        WHERE period_key>=? AND period_key<? AND stream_start IS NOT NULL
        ORDER BY period_key ASC LIMIT 1`).bind(range.startKey, range.endKey).first(),
      otherDb.prepare(`SELECT period_key,stream_end FROM sh_daily_summary
        WHERE period_key>=? AND period_key<? AND stream_end IS NOT NULL
        ORDER BY period_key DESC LIMIT 1`).bind(range.startKey, range.endKey).first(),
      otherDb.prepare(`SELECT stream_start,stream_end,stream_growth,quality_flags FROM sh_weekly_summary
        WHERE period_key=? LIMIT 1`).bind(range.key).first(),
    ]);
    if (!parent || !first || !last) continue;
    const streamStart = finite(first.stream_start);
    const streamEnd = finite(last.stream_end);
    const streamGrowth = growth(streamStart, streamEnd);
    if (streamStart == null || streamEnd == null || streamGrowth == null) continue;
    const qualityFlags = addFlag(parent.quality_flags);
    if (finite(parent.stream_start) === streamStart
        && finite(parent.stream_end) === streamEnd
        && finite(parent.stream_growth) === streamGrowth
        && parent.quality_flags === qualityFlags) continue;
    await otherDb.prepare(`UPDATE sh_weekly_summary
      SET stream_start=?,stream_end=?,stream_growth=?,quality_flags=?,updated_at=?
      WHERE period_key=?`).bind(streamStart, streamEnd, streamGrowth, qualityFlags, now, range.key).run();
    report.weekly.push({
      key: range.key,
      before: [parent.stream_start, parent.stream_end, parent.stream_growth],
      after: [streamStart, streamEnd, streamGrowth],
      source_days: [first.period_key, last.period_key],
    });
  }
  return report;
}

export async function repairHistoricalStreamBoundaries({
  otherDb,
  now = Date.now(),
  ranges = KNOWN_RANGES,
  maxGapMs = DEFAULT_MAX_BOUNDARY_GAP_MS,
} = {}) {
  if (!otherDb) throw new Error('otherDb is required');
  const daily = [];
  const skipped = [];
  const repairedDayKeys = new Set();

  for (const range of ranges) {
    const evidenceFrom = addDays(range.start, -1);
    const evidenceTo = addDays(range.end, 1);
    const rows = await loadDailyRows(otherDb, evidenceFrom, evidenceTo);
    const byDay = new Map(rows.map((row) => [String(row.period_key), row]));
    const boundaries = new Map();

    for (let key = range.start; key <= addDays(range.end, 1); key = addDays(key, 1)) {
      const estimate = estimateBoundary(byDay.get(addDays(key, -1)), byDay.get(key), key, maxGapMs);
      if (estimate.ok) boundaries.set(key, estimate);
      else skipped.push({ key, reason: estimate.reason, gap_ms: estimate.gap_ms ?? null, range: range.reason });
    }

    for (let key = range.start; key <= range.end; key = addDays(key, 1)) {
      const row = byDay.get(key);
      const start = boundaries.get(key);
      const end = boundaries.get(addDays(key, 1));
      if (!row || !start || !end) {
        skipped.push({ key, reason: 'daily_boundary_pair_unavailable', range: range.reason });
        continue;
      }
      const streamGrowth = growth(start.value, end.value);
      if (streamGrowth == null) {
        skipped.push({ key, reason: 'daily_interpolated_counter_decrease', range: range.reason });
        continue;
      }
      const qualityFlags = addFlag(row.quality_flags);
      if (finite(row.stream_start) === start.value
          && finite(row.stream_end) === end.value
          && finite(row.stream_growth) === streamGrowth
          && row.quality_flags === qualityFlags) continue;
      await otherDb.prepare(`UPDATE sh_daily_summary
        SET stream_start=?,stream_end=?,stream_growth=?,quality_flags=?,updated_at=?
        WHERE period_key=?`).bind(start.value, end.value, streamGrowth, qualityFlags, now, key).run();
      daily.push({
        key,
        reason: range.reason,
        before: [row.stream_start, row.stream_end, row.stream_growth],
        after: [start.value, end.value, streamGrowth],
        start_evidence: start,
        end_evidence: end,
      });
      repairedDayKeys.add(key);
    }
  }

  const parents = repairedDayKeys.size
    ? await repairParentPeriods(otherDb, [...repairedDayKeys], now)
    : { weekly: [] };
  return { ok: true, daily, skipped, ...parents };
}

async function main() {
  const otherDb = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await repairHistoricalStreamBoundaries({ otherDb });
  console.log(JSON.stringify({ event: 'historical_stream_boundary_repair', ...result }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();