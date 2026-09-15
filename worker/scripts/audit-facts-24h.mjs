import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const channelId = Math.max(1, Math.trunc(Number(process.env.CHANNEL_ID || 318)));
const windowMs = 24 * 60 * 60 * 1000;
const endMinute = Math.floor(Date.now() / 60000) * 60000;
const startMinute = endMinute - windowMs;

function wrangler(args) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function rows(payload) {
  const containers = Array.isArray(payload) ? payload : [payload];
  for (const container of containers) {
    const value = container?.results || container?.result?.[0]?.results || container?.result?.results;
    if (Array.isArray(value)) return value;
  }
  return [];
}

function parse(raw) {
  const text = String(raw || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error('Wrangler did not return JSON');
  return JSON.parse(text.slice(Math.min(...starts)));
}

const sql = `SELECT COUNT(*) AS row_count,
  COUNT(DISTINCT minute_at) AS minute_count,
  MIN(minute_at) AS first_minute_at,
  MAX(minute_at) AS last_minute_at
FROM sh_minute_facts
WHERE channel_id=${channelId} AND minute_at>=${startMinute} AND minute_at<${endMinute}`;
const result = rows(parse(wrangler([
  'd1', 'execute', databaseName, '--remote', '--yes', '--json', '--command', sql,
])))[0] || {};
const summary = {
  database_name: databaseName,
  channel_id: channelId,
  window_start_ms: startMinute,
  window_end_ms: endMinute,
  window_start: new Date(startMinute).toISOString(),
  window_end: new Date(endMinute).toISOString(),
  row_count: Number(result.row_count || 0),
  distinct_minute_count: Number(result.minute_count || 0),
  first_minute_at: Number(result.first_minute_at || 0) || null,
  last_minute_at: Number(result.last_minute_at || 0) || null,
};
summary.needs_repair = summary.distinct_minute_count < 1440;

console.log(JSON.stringify(summary));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `needs_repair=${summary.needs_repair}\nwindow_start_ms=${startMinute}\nwindow_end_ms=${endMinute}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n## Stationhead minute facts — last 24 hours\n\n- Channel: **${channelId}**\n- Rows: **${summary.row_count}**\n- Distinct minutes: **${summary.distinct_minute_count} / 1440**\n- Repair required: **${summary.needs_repair}**\n- Window: ${summary.window_start} → ${summary.window_end}\n`);
}
