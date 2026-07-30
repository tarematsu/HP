import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const outputDirectory = resolve(repositoryRoot, '.local-minute-facts');
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const channelId = Math.max(1, Math.trunc(Number(process.env.CHANNEL_ID || 318)));
const MINUTE_MS = 60_000;
const RECENT_GUARD_MS = Math.max(0, Math.trunc(Number(process.env.MINUTE_FACT_RECENT_GUARD_MS || 300_000)));
const DEFAULT_FROM = '2026-06-23T00:00:00Z';
const PAGE_SIZE = 5_000;

function wrangler(database, command, options = {}) {
  const args = [
    wranglerScript,
    'd1', 'execute', database,
    '--remote', '--yes',
  ];
  if (options.json !== false) args.push('--json');
  if (options.file) args.push('--file', options.file);
  else args.push('--command', command);
  return execFileSync(process.execPath, args, {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function parseWranglerRows(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  for (const container of containers) {
    const rows = container?.results
      || container?.result?.results
      || container?.result?.[0]?.results;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function timestamp(value, fallback = null) {
  if (value == null || String(value).trim() === '') return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.trunc(numeric);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function range(now = Date.now()) {
  const start = timestamp(process.env.MINUTE_FACT_BACKFILL_FROM, Date.parse(DEFAULT_FROM));
  const requestedTo = timestamp(process.env.MINUTE_FACT_BACKFILL_TO, null);
  const cutoff = requestedTo ?? now - RECENT_GUARD_MS;
  if (!Number.isFinite(start) || !Number.isFinite(cutoff) || start >= cutoff) {
    throw new Error(`invalid backfill range: ${start}..${cutoff}`);
  }
  return { start, cutoff };
}

function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  writeFileSync(output, `${name}=${value}\n`, { encoding: 'utf8', flag: 'a' });
}

function exportRange() {
  mkdirSync(outputDirectory, { recursive: true });
  const { start, cutoff } = range();
  const columns = `id,observed_at,channel_id,station_id,is_broadcasting,
    listener_count,online_member_count,total_member_count,guest_count,
    total_listens,current_stream_count,broadcast_start_time,host_handle`;
  const snapshotSql = `WITH previous AS (
      SELECT ${columns}
      FROM sh_channel_snapshots
      WHERE channel_id=${channelId} AND observed_at<${start}
      ORDER BY observed_at DESC,id DESC
      LIMIT 1
    ) SELECT * FROM previous`;
  const previous = parseWranglerRows(wrangler(buddiesDatabase, snapshotSql));
  const snapshots = [...previous];
  let cursorObservedAt = start;
  let cursorId = -1;
  for (;;) {
    const rows = parseWranglerRows(wrangler(
      buddiesDatabase,
      `SELECT ${columns} FROM sh_channel_snapshots
        WHERE channel_id=${channelId}
          AND observed_at>=${start} AND observed_at<${cutoff}
          AND (observed_at>${cursorObservedAt}
            OR (observed_at=${cursorObservedAt} AND id>${cursorId}))
        ORDER BY observed_at ASC,id ASC LIMIT ${PAGE_SIZE}`,
    ));
    if (!rows.length) break;
    snapshots.push(...rows);
    const last = rows.at(-1);
    cursorObservedAt = Number(last.observed_at);
    cursorId = Number(last.id);
    if (rows.length < PAGE_SIZE) break;
  }
  const comments = [];
  let cursorBucket = start - 10 * MINUTE_MS;
  let cursorStation = -1;
  for (;;) {
    const rows = parseWranglerRows(wrangler(
      buddiesDatabase,
      `SELECT station_id,bucket_start,comment_count FROM sh_comment_minute_counts
        WHERE bucket_start>=${start - 10 * MINUTE_MS} AND bucket_start<${cutoff}
          AND (bucket_start>${cursorBucket}
            OR (bucket_start=${cursorBucket} AND station_id>${cursorStation}))
        ORDER BY bucket_start ASC,station_id ASC LIMIT ${PAGE_SIZE}`,
    ));
    if (!rows.length) break;
    comments.push(...rows);
    const last = rows.at(-1);
    cursorBucket = Number(last.bucket_start);
    cursorStation = Number(last.station_id);
    if (rows.length < PAGE_SIZE) break;
  }
  const snapshotsPayload = JSON.stringify([{ results: snapshots }]);
  const commentsPayload = JSON.stringify([{ results: comments }]);
  writeFileSync(resolve(outputDirectory, 'snapshots.json'), snapshotsPayload);
  writeFileSync(resolve(outputDirectory, 'comments.json'), commentsPayload);
  const metadata = {
    from_ms: start,
    cutoff_ms: cutoff,
    channel_id: channelId,
    snapshots: snapshots.length,
    comments: comments.length,
  };
  writeFileSync(resolve(outputDirectory, 'range.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  writeOutput('window_start_ms', start);
  writeOutput('cutoff_ms', cutoff);
  console.log(JSON.stringify({ event: 'minute_fact_range_export', ...metadata }));
}

function latestExpectedMinutes(rows, start, cutoff) {
  const byKey = new Map();
  for (const row of rows) {
    const observedAt = Number(row.observed_at);
    const rowChannel = Number(row.channel_id);
    if (!Number.isFinite(observedAt) || !Number.isFinite(rowChannel)
        || observedAt < start || observedAt >= cutoff) continue;
    const minuteAt = Math.floor(observedAt / MINUTE_MS) * MINUTE_MS;
    const key = `${rowChannel}:${minuteAt}`;
    const current = byKey.get(key);
    if (!current || observedAt > Number(current.observed_at)
        || (observedAt === Number(current.observed_at) && Number(row.id) > Number(current.id))) {
      byKey.set(key, row);
    }
  }
  return byKey;
}

function settleJobs(start, cutoff) {
  const now = Date.now();
  const sql = `UPDATE sh_minute_fact_jobs SET
      status='done',processed_at=${now},next_attempt_at=0,lease_until=NULL,
      last_error=NULL,updated_at=${now}
    WHERE channel_id=${channelId}
      AND minute_at>=${Math.floor(start / MINUTE_MS) * MINUTE_MS}
      AND minute_at<${cutoff}
      AND job_kind='rebuild'
      AND EXISTS (
        SELECT 1 FROM sh_minute_facts f
        WHERE f.channel_id=sh_minute_fact_jobs.channel_id
          AND f.minute_at=sh_minute_fact_jobs.minute_at
      )`;
  wrangler(factsDatabase, sql);
}

function verifyRange() {
  const metadata = JSON.parse(readFileSync(resolve(outputDirectory, 'range.json'), 'utf8'));
  const snapshots = parseWranglerRows(readFileSync(resolve(outputDirectory, 'snapshots.json'), 'utf8'));
  const expected = latestExpectedMinutes(snapshots, metadata.from_ms, metadata.cutoff_ms);
  settleJobs(metadata.from_ms, metadata.cutoff_ms);
  const facts = [];
  let factCursor = Math.floor(metadata.from_ms / MINUTE_MS) * MINUTE_MS - 1;
  for (;;) {
    const rows = parseWranglerRows(wrangler(
      factsDatabase,
      `SELECT channel_id,minute_at,source_priority FROM sh_minute_facts
        WHERE channel_id=${channelId}
          AND minute_at>${factCursor} AND minute_at<${metadata.cutoff_ms}
        ORDER BY minute_at ASC LIMIT ${PAGE_SIZE}`,
    ));
    if (!rows.length) break;
    facts.push(...rows);
    factCursor = Number(rows.at(-1).minute_at);
    if (rows.length < PAGE_SIZE) break;
  }
  const factKeys = new Set(facts.map((row) => `${Number(row.channel_id)}:${Number(row.minute_at)}`));
  const missing = [...expected.keys()].filter((key) => !factKeys.has(key));
  const jobs = parseWranglerRows(wrangler(
    factsDatabase,
    `SELECT status,COUNT(*) AS count FROM sh_minute_fact_jobs
      WHERE channel_id=${channelId}
        AND minute_at>=${Math.floor(metadata.from_ms / MINUTE_MS) * MINUTE_MS}
        AND minute_at<${metadata.cutoff_ms}
        AND job_kind='rebuild' AND status IN ('pending','processing','dead')
      GROUP BY status ORDER BY status`,
  ));
  const report = {
    event: 'minute_fact_range_verification',
    from_ms: metadata.from_ms,
    cutoff_ms: metadata.cutoff_ms,
    expected_exact_minutes: expected.size,
    materialized_minutes: facts.length,
    missing_exact_minutes: missing.length,
    unresolved_rebuild_jobs: Object.fromEntries(jobs.map((row) => [row.status, Number(row.count || 0)])),
    first_missing: missing.slice(0, 20),
  };
  writeFileSync(resolve(outputDirectory, 'fact-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (missing.length || jobs.length) throw new Error('minute fact range verification failed');
}

const command = process.argv[2] || 'export';
if (command === 'export') exportRange();
else if (command === 'verify') verifyRange();
else throw new Error(`unsupported command: ${command}`);
