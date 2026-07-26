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
const RECENT_GUARD_MS = 5 * MINUTE_MS;
const OVERLAP_MS = 10 * MINUTE_MS;
const MAX_CATCHUP_MS = 24 * 60 * MINUTE_MS;
const ACTION_TASKS = Object.freeze(['recovery', 'rebuild', 'sync']);

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
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

export function parseWranglerRows(output) {
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

function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  writeFileSync(output, `${name}=${value}\n`, { encoding: 'utf8', flag: 'a' });
}

function exportWindow(now = Date.now()) {
  mkdirSync(outputDirectory, { recursive: true });
  const cutoff = now - RECENT_GUARD_MS;
  const cursorRows = parseWranglerRows(wrangler(
    factsDatabase,
    `SELECT MIN(last_success_at) AS cursor_at
       FROM sh_minute_fact_runtime_state
      WHERE task_name IN ('recovery','rebuild','sync')`,
  ));
  const cursor = Number(cursorRows[0]?.cursor_at);
  const fallbackStart = cutoff - MAX_CATCHUP_MS;
  const windowStart = Math.max(
    fallbackStart,
    Number.isFinite(cursor) && cursor > 0 ? cursor - OVERLAP_MS : fallbackStart,
  );

  const columns = `id,observed_at,channel_id,station_id,is_broadcasting,
    listener_count,online_member_count,total_member_count,guest_count,
    total_listens,current_stream_count,broadcast_start_time`;
  const snapshotSql = `WITH previous AS (
      SELECT ${columns}
      FROM sh_channel_snapshots
      WHERE channel_id=${channelId} AND observed_at<${windowStart}
      ORDER BY observed_at DESC,id DESC
      LIMIT 1
    ), active AS (
      SELECT ${columns}
      FROM sh_channel_snapshots
      WHERE channel_id=${channelId}
        AND observed_at>=${windowStart} AND observed_at<${cutoff}
    )
    SELECT * FROM previous
    UNION ALL
    SELECT * FROM active
    ORDER BY observed_at ASC,id ASC`;
  const commentsSql = `SELECT station_id,bucket_start,comment_count
    FROM sh_comment_minute_counts
    WHERE bucket_start>=${windowStart - OVERLAP_MS} AND bucket_start<${cutoff}
    ORDER BY bucket_start ASC,station_id ASC`;
  const snapshots = wrangler(buddiesDatabase, snapshotSql);
  const comments = wrangler(buddiesDatabase, commentsSql);
  writeFileSync(resolve(outputDirectory, 'snapshots.json'), snapshots);
  writeFileSync(resolve(outputDirectory, 'comments.json'), comments);
  writeOutput('window_start_ms', windowStart);
  writeOutput('cutoff_ms', cutoff);
  console.log(JSON.stringify({
    ok: true,
    window_start_ms: windowStart,
    cutoff_ms: cutoff,
    snapshots: parseWranglerRows(snapshots).length,
    comments: parseWranglerRows(comments).length,
  }));
}

function stateUpsert(task, now, processed) {
  return `INSERT INTO sh_minute_fact_runtime_state(
      task_name,last_started_at,last_success_at,last_failure_at,last_duration_ms,last_error,
      runs_total,succeeded_total,failed_total,processed_total,job_failures_total,
      last_processed_count,last_failed_count,pending_count,processing_count,dead_count,
      oldest_pending_minute,updated_at
    ) VALUES('${task}',${now},${now},NULL,0,NULL,1,1,0,${processed},0,${processed},0,0,0,0,NULL,${now})
    ON CONFLICT(task_name) DO UPDATE SET
      last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,
      last_duration_ms=excluded.last_duration_ms,last_error=NULL,
      runs_total=sh_minute_fact_runtime_state.runs_total+1,
      succeeded_total=sh_minute_fact_runtime_state.succeeded_total+1,
      processed_total=sh_minute_fact_runtime_state.processed_total+excluded.processed_total,
      last_processed_count=excluded.last_processed_count,last_failed_count=0,
      pending_count=0,processing_count=0,dead_count=0,
      oldest_pending_minute=NULL,updated_at=excluded.updated_at;`;
}

function completeRun(now = Date.now()) {
  const manifest = JSON.parse(readFileSync(
    resolve(outputDirectory, 'generated', 'manifest.json'),
    'utf8',
  ));
  const processed = Math.max(0, Math.trunc(Number(manifest.candidates || 0)));
  const statePath = resolve(outputDirectory, 'actions-runtime-state.sql');
  writeFileSync(
    statePath,
    `${ACTION_TASKS.map((task) => stateUpsert(task, now, processed)).join('\n')}\n`,
  );
  wrangler(factsDatabase, '', { json: false, file: statePath });
  console.log(JSON.stringify({ ok: true, tasks: ACTION_TASKS, processed, completed_at: now }));
}

const command = process.argv[2] || 'export';
if (command === 'export') exportWindow();
else if (command === 'complete') completeRun();
else throw new Error(`unsupported command: ${command}`);
