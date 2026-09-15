import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const outputDirectory = resolve(repositoryRoot, '.facts-24h-repair');
const databaseName = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const channelId = Math.max(1, Math.trunc(Number(process.env.CHANNEL_ID || 318)));
const start = Math.trunc(Number(process.env.WINDOW_START_MS));
const end = Math.trunc(Number(process.env.WINDOW_END_MS));
if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('invalid repair window');

function query(sql) {
  return execFileSync(process.execPath, [wranglerScript,
    'd1', 'execute', databaseName, '--remote', '--yes', '--json', '--command', sql,
  ], { cwd: workerRoot, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

mkdirSync(outputDirectory, { recursive: true });
const columns = `id,observed_at,channel_id,station_id,is_broadcasting,
  listener_count,online_member_count,total_member_count,guest_count,
  total_listens,current_stream_count,broadcast_start_time`;
const snapshots = query(`WITH previous AS (
    SELECT ${columns} FROM sh_channel_snapshots
    WHERE channel_id=${channelId} AND observed_at<${start}
    ORDER BY observed_at DESC,id DESC LIMIT 1
  ), active AS (
    SELECT ${columns} FROM sh_channel_snapshots
    WHERE channel_id=${channelId} AND observed_at>=${start} AND observed_at<${end}
  )
  SELECT * FROM previous UNION ALL SELECT * FROM active
  ORDER BY observed_at ASC,id ASC`);
const comments = query(`SELECT station_id,bucket_start,comment_count
  FROM sh_comment_minute_counts
  WHERE bucket_start>=${start} AND bucket_start<${end}
  ORDER BY bucket_start ASC,station_id ASC`);
writeFileSync(resolve(outputDirectory, 'snapshots.json'), snapshots);
writeFileSync(resolve(outputDirectory, 'comments.json'), comments);
console.log(JSON.stringify({ ok: true, channel_id: channelId, window_start_ms: start, window_end_ms: end }));
