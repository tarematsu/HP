import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { directFiveMinuteStreamHistory } from '../../site/functions/lib/dashboard-chart-support.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const FIVE_MINUTES_MS = 5 * 60_000;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const dashboardKey = pagesActionsR2ResponseKey('dashboard');
const hotStateKey = 'stationhead/buddies/dashboard-hot-state.json';

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function bucketAt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number / FIVE_MINUTES_MS) * FIVE_MINUTES_MS : null;
}

function detectGaps(history) {
  const buckets = [...new Set((Array.isArray(history) ? history : [])
    .map((row) => bucketAt(row?.observed_at))
    .filter((value) => value != null))]
    .sort((left, right) => left - right);
  const gaps = [];
  for (let index = 1; index < buckets.length; index += 1) {
    const previous = buckets[index - 1];
    const current = buckets[index];
    if (current - previous > FIVE_MINUTES_MS) {
      gaps.push({ after: previous, before: current });
    }
  }
  return gaps;
}

function mergeHistory(history, rows) {
  const byBucket = new Map();
  for (const row of Array.isArray(history) ? history : []) {
    const point = bucketAt(row?.observed_at);
    if (point != null) byBucket.set(point, { ...row, observed_at: point });
  }
  for (const row of rows) {
    const point = bucketAt(row?.bucket_at ?? row?.observed_at);
    if (point == null || byBucket.has(point)) continue;
    byBucket.set(point, {
      observed_at: point,
      listener_count: row?.listener_count ?? null,
      online_member_count: row?.online_member_count ?? null,
      total_member_count: row?.total_member_count ?? null,
      total_listens: row?.total_listens ?? null,
      current_stream_count: row?.current_stream_count ?? null,
    });
  }
  return [...byBucket.values()]
    .sort((left, right) => left.observed_at - right.observed_at)
    .slice(-300);
}

function readEnvelope() {
  const directory = mkdtempSync(join(workerRoot, '.dashboard-gap-read-'));
  try {
    const file = join(directory, 'dashboard.json');
    wrangler([
      'r2', 'object', 'get', `${responseBucket}/${dashboardKey}`,
      '--remote', '--file', file,
    ]);
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    const payload = typeof envelope?.body === 'string' ? JSON.parse(envelope.body) : envelope?.body;
    if (Number(envelope?.version) !== 1 || !payload?.ok || !Array.isArray(payload?.history)) {
      throw new Error('current dashboard R2 envelope is invalid');
    }
    return { envelope, payload };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function uploadJson(key, value) {
  const directory = mkdtempSync(join(workerRoot, '.dashboard-gap-write-'));
  try {
    const file = join(directory, 'object.json');
    writeFileSync(file, JSON.stringify(value), 'utf8');
    wrangler([
      'r2', 'object', 'put', `${responseBucket}/${key}`,
      '--remote', '--file', file,
      '--content-type', 'application/json; charset=utf-8',
    ], { capture: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const { envelope, payload } = readEnvelope();
const gapsBefore = detectGaps(payload.history);
if (!gapsBefore.length) {
  console.log(JSON.stringify({
    event: 'buddies_dashboard_gap_backfill_skipped',
    reason: 'no-read-model-gaps',
    history_rows: payload.history.length,
  }));
  process.exit(0);
}

const minuteDb = createWranglerRemoteD1({
  database: factsDatabase,
  cwd: workerRoot,
  wranglerScript,
  maxRetries: 2,
});
const channelId = Number(payload?.latest?.channel_id);
if (!Number.isFinite(channelId)) throw new Error('dashboard channel_id is unavailable');

const recovered = [];
for (const gap of gapsBefore) {
  const result = await minuteDb.prepare(`SELECT
      channel_id,bucket_at,observed_at,listener_count,online_member_count,
      total_member_count,total_listens,current_stream_count
    FROM sh_dashboard_history_5m
    WHERE channel_id=? AND bucket_at>? AND bucket_at<?
    ORDER BY bucket_at ASC`)
    .bind(channelId, gap.after, gap.before)
    .all();
  recovered.push(...(result?.results || []));
}

if (!recovered.length) {
  console.log(JSON.stringify({
    event: 'buddies_dashboard_gap_backfill_skipped',
    reason: 'source-has-no-gap-rows',
    detected_gap_count: gapsBefore.length,
    detected_gaps: gapsBefore,
  }));
  process.exit(0);
}

const history = mergeHistory(payload.history, recovered);
const gapsAfter = detectGaps(history);
const now = Date.now();
const nextPayload = {
  ...payload,
  history,
  stream_5m_history: directFiveMinuteStreamHistory(history),
  _targeted_gap_backfill_at: now,
};
const nextEnvelope = {
  ...envelope,
  updated_at: now,
  body: JSON.stringify(nextPayload),
};
const nextHotState = {
  version: 1,
  updated_at: now,
  payload: nextPayload,
};

uploadJson(dashboardKey, nextEnvelope);
uploadJson(hotStateKey, nextHotState);

console.log(JSON.stringify({
  event: 'buddies_dashboard_gap_backfill_complete',
  detected_gap_count: gapsBefore.length,
  recovered_rows: recovered.length,
  history_rows_before: payload.history.length,
  history_rows_after: history.length,
  remaining_gap_count: gapsAfter.length,
  detected_gaps: gapsBefore,
  remaining_gaps: gapsAfter,
  dashboard_key: dashboardKey,
  hot_state_key: hotStateKey,
}));
