import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
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

const sql = `SELECT source_code,
  COUNT(*) AS row_count,
  COUNT(DISTINCT minute_at) AS minute_count,
  MIN(minute_at) AS first_minute_at,
  MAX(minute_at) AS last_minute_at
FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
WHERE source_code=1 AND minute_at>=${startMinute} AND minute_at<${endMinute}
GROUP BY source_code`;

const raw = wrangler(['d1', 'execute', databaseName, '--remote', '--yes', '--json', '--command', sql]);
const text = String(raw || '').trim();
const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
if (!starts.length) throw new Error('Wrangler did not return JSON');
const result = rows(JSON.parse(text.slice(Math.min(...starts))))[0] || {};
const summary = {
  database_name: databaseName,
  window_start: new Date(startMinute).toISOString(),
  window_end: new Date(endMinute).toISOString(),
  row_count: Number(result.row_count || 0),
  distinct_minute_count: Number(result.minute_count || 0),
  first_minute_at: Number(result.first_minute_at || 0) || null,
  last_minute_at: Number(result.last_minute_at || 0) || null,
};

console.log(JSON.stringify(summary));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n## Stationhead minute facts — last 24 hours\n\n- Rows: **${summary.row_count}**\n- Distinct minutes: **${summary.distinct_minute_count} / 1440**\n- Window: ${summary.window_start} → ${summary.window_end}\n`);
}

if (summary.row_count === 0 || summary.distinct_minute_count === 0) {
  throw new Error(`No live minute facts found in the last 24 hours: ${JSON.stringify(summary)}`);
}
