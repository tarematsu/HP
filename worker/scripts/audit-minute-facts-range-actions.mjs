import { resolve } from 'node:path';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const startAt = Date.parse(process.env.MINUTE_FACT_BACKFILL_FROM || '2026-06-23T00:00:00Z');
const finishedAt = Number(process.env.MINUTE_FACT_BACKFILL_TO_MS || Date.now());

if (!Number.isFinite(startAt) || !Number.isFinite(finishedAt) || startAt >= finishedAt) {
  throw new Error('invalid minute fact audit range');
}

function database(name, suffix) {
  return createWranglerRemoteD1({
    database: name,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: `.minute-fact-audit-${suffix}-`,
  });
}

const buddies = database(process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies', 'buddies');
const minute = database(process.env.FACTS_DATABASE_NAME || 'stationhead-minute', 'minute');
const other = database(process.env.OTHER_DATABASE_NAME || 'stationhead-other', 'other');

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function minuteAt(row) {
  return Math.floor(Number(row.observed_at) / 60_000) * 60_000;
}

function key(channelId, minute) {
  return `${Number(channelId)}:${Number(minute)}`;
}

function expectedSourceRecordId(row) {
  return `snapshot:${Number(row.id)}:minute:${minuteAt(row)}:exact`;
}

async function expectedRows(start, end) {
  const result = await buddies.prepare(`SELECT id,observed_at,channel_id FROM (
      SELECT id,observed_at,channel_id,ROW_NUMBER() OVER (
        PARTITION BY channel_id,CAST(observed_at/60000 AS INTEGER)
        ORDER BY observed_at DESC,id DESC
      ) AS source_rank
      FROM sh_channel_snapshots
      WHERE observed_at>=? AND observed_at<?
    ) WHERE source_rank=1 ORDER BY observed_at ASC,id ASC`)
    .bind(start, end)
    .all();
  return result.results || [];
}

async function factRows(start, end) {
  const result = await minute.prepare(`SELECT channel_id,minute_at,source_record_id,source_priority
      FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
      WHERE minute_at>=? AND minute_at<?`)
    .bind(start, end)
    .all();
  return result.results || [];
}

async function jobsFor(start, end) {
  const result = await minute.prepare(`SELECT status,COUNT(*) AS count FROM sh_minute_fact_jobs
      WHERE minute_at>=? AND minute_at<? AND job_kind='rebuild'
      GROUP BY status ORDER BY status`)
    .bind(start, end)
    .all();
  return Object.fromEntries((result.results || []).map((row) => [String(row.status), Number(row.count || 0)]));
}

async function dailySummary(periodKey) {
  return other.prepare(`SELECT period_key,sample_count,reliable_sample_count,quality_flags,updated_at
      FROM sh_daily_summary WHERE period_key=? LIMIT 1`)
    .bind(periodKey)
    .first();
}

const totals = {
  expected: 0,
  materialized: 0,
  missing: 0,
  stale: 0,
  pending: 0,
  processing: 0,
  dead: 0,
};
const days = [];

for (let dayStart = startAt; dayStart < finishedAt; dayStart += DAY_MS) {
  const dayEnd = Math.min(dayStart + DAY_MS, finishedAt);
  const [expected, facts, jobs, summary] = await Promise.all([
    expectedRows(dayStart, dayEnd),
    factRows(dayStart, dayEnd),
    jobsFor(dayStart, dayEnd),
    dailySummary(dayKey(dayStart)),
  ]);
  const materialized = new Map(facts.map((row) => [key(row.channel_id, row.minute_at), row]));
  let missing = 0;
  let stale = 0;
  for (const row of expected) {
    const fact = materialized.get(key(row.channel_id, minuteAt(row)));
    if (!fact) {
      missing += 1;
    } else if (String(fact.source_record_id || '') !== expectedSourceRecordId(row)
        || Number(fact.source_priority || 0) < 90) {
      stale += 1;
    }
  }
  const report = {
    day: dayKey(dayStart),
    partial: dayEnd < dayStart + DAY_MS,
    expected: expected.length,
    materialized: materialized.size,
    missing,
    stale,
    jobs,
    summary: summary ? {
      sample_count: Number(summary.sample_count || 0),
      reliable_sample_count: Number(summary.reliable_sample_count || 0),
      quality_flags: summary.quality_flags,
      updated_at: Number(summary.updated_at || 0),
    } : null,
  };
  days.push(report);
  totals.expected += expected.length;
  totals.materialized += materialized.size;
  totals.missing += missing;
  totals.stale += stale;
  totals.pending += Number(jobs.pending || 0);
  totals.processing += Number(jobs.processing || 0);
  totals.dead += Number(jobs.dead || 0);
  console.log(JSON.stringify({ event: 'minute_fact_range_day_audit', ...report }));
}

const report = {
  event: 'minute_fact_range_audit',
  from: new Date(startAt).toISOString(),
  to: new Date(finishedAt).toISOString(),
  days: days.length,
  ...totals,
};
console.log(JSON.stringify(report));

if (totals.missing > 0 || totals.stale > 0 || totals.dead > 0) process.exitCode = 2;
