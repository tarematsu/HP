import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { utcWeeklyRange } from '../../site/functions/lib/time-buckets.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const FLAG = 'stream_end_next_day_start_single_sample_v1';
const KNOWN_RANGES = [
  { start: '2024-09-02', end: '2024-10-07', reason: 'known_2024_daily_opening_only' },
  { start: '2025-08-01', end: '2025-09-30', reason: 'known_2025_aug_sep_daily_opening_only' },
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

function nextDayKey(key) {
  return dayKey(Date.parse(`${key}T00:00:00Z`) + DAY_MS);
}

function growth(start, end) {
  return start != null && end != null && end >= start ? end - start : null;
}

function parseFlags(value) {
  const parsed = JSON.parse(value || '[]');
  if (!Array.isArray(parsed)) throw new Error('summary quality_flags must be an array');
  return parsed;
}

function addFlag(value) {
  return JSON.stringify([...new Set([...parseFlags(value), FLAG])]);
}

function knownHistoricalRange(key) {
  return KNOWN_RANGES.find((range) => key >= range.start && key <= range.end) || null;
}

function isCandidate(row) {
  const key = String(row?.period_key || '');
  const start = finite(row?.stream_start);
  if (start == null) return false;
  if (knownHistoricalRange(key)) return true;
  const end = finite(row?.stream_end);
  if (end != null && end !== start) return false;
  if (parseFlags(row?.quality_flags).includes(FLAG)) return false;
  return Number(row.sample_count) === 1;
}

async function repairParentPeriodEnds(otherDb, dailyRepairs, now) {
  const report = { weekly: [] };
  const parents = await otherDb.prepare(`SELECT period_key,stream_start,stream_end,stream_growth
    FROM sh_weekly_summary ORDER BY period_key`).all();
  for (const parent of parents.results || []) {
    const range = utcWeeklyRange(parent.period_key);
    const boundaryRepair = dailyRepairs.find((row) => nextDayKey(String(row.key)) === range.endKey);
    if (!boundaryRepair) continue;
    const previousDailyEnd = finite(boundaryRepair.before[1]);
    const parentEnd = finite(parent.stream_end);
    if (parentEnd !== previousDailyEnd) continue;
    const streamEnd = finite(boundaryRepair.after[1]);
    const streamStart = finite(parent.stream_start);
    const streamGrowth = growth(streamStart, streamEnd);
    if (parentEnd === streamEnd && finite(parent.stream_growth) === streamGrowth) continue;
    const result = await otherDb.prepare(`UPDATE sh_weekly_summary SET stream_end=?,stream_growth=?,updated_at=?
      WHERE period_key=? AND stream_end IS ? AND stream_growth IS ?`)
      .bind(streamEnd, streamGrowth, now, parent.period_key, parent.stream_end, parent.stream_growth).run();
    if (Number(result?.meta?.changes ?? result?.changes ?? 0) < 1) continue;
    report.weekly.push({
      key: parent.period_key,
      before: [parent.stream_start, parent.stream_end, parent.stream_growth],
      after: [streamStart, streamEnd, streamGrowth],
      source_day: boundaryRepair.key,
    });
  }
  return report;
}

export async function repairSingleSampleStreamSummaries({ otherDb, now = Date.now() } = {}) {
  if (!otherDb) throw new Error('otherDb is required');
  const today = dayKey(now);
  const original = await otherDb.prepare(`SELECT period_key,sample_count,stream_start,stream_end,stream_growth,quality_flags
    FROM sh_daily_summary WHERE period_key<? ORDER BY period_key`).bind(today).all();
  const rows = original.results || [];
  const byDay = new Map(rows.map((row) => [String(row.period_key), row]));
  const daily = [];

  for (const row of rows) {
    if (!isCandidate(row)) continue;
    const next = byDay.get(nextDayKey(String(row.period_key)));
    if (!next) continue;
    const streamStart = finite(row.stream_start);
    const nextStart = finite(next.stream_start);
    if (streamStart == null || nextStart == null || nextStart < streamStart) continue;
    if (parseFlags(next.quality_flags).includes('stream_start_previous_day_end')) continue;
    const streamGrowth = growth(streamStart, nextStart);
    if (finite(row.stream_end) === nextStart && finite(row.stream_growth) === streamGrowth) continue;
    const qualityFlags = addFlag(row.quality_flags);
    const result = await otherDb.prepare(`UPDATE sh_daily_summary
      SET stream_end=?,stream_growth=?,quality_flags=?,updated_at=?
      WHERE period_key=? AND sample_count IS ? AND stream_start IS ? AND stream_end IS ? AND quality_flags IS ?`)
      .bind(nextStart, streamGrowth, qualityFlags, now, row.period_key, row.sample_count,
        row.stream_start, row.stream_end, row.quality_flags).run();
    if (Number(result?.meta?.changes ?? result?.changes ?? 0) < 1) continue;
    const knownRange = knownHistoricalRange(String(row.period_key));
    daily.push({
      key: row.period_key,
      reason: knownRange?.reason || 'single_sample_day',
      before: [row.stream_start, row.stream_end, row.stream_growth],
      after: [streamStart, nextStart, streamGrowth],
      next_day: next.period_key,
    });
  }

  if (!daily.length) return { ok: true, daily: [], weekly: [] };
  const parents = await repairParentPeriodEnds(otherDb, daily, now);
  return { ok: true, daily, ...parents };
}

async function main() {
  const otherDb = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await repairSingleSampleStreamSummaries({ otherDb });
  console.log(JSON.stringify({ event: 'single_sample_stream_summary_repair', ...result }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();