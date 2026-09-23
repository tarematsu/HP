import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { auditListenerAnomalies } from '../src/listener-anomaly-audit.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const channelId = Math.max(1, Math.trunc(Number(process.env.CHANNEL_ID || 318)));
const minuteMs = 60_000;
const windowMs = 24 * 60 * minuteMs;
const recentGuardMs = 5 * minuteMs;
const requestedStart = Number(process.env.AUDIT_WINDOW_START_MS);
const requestedEnd = Number(process.env.AUDIT_WINDOW_END_MS);
const fixedWindow = Number.isFinite(requestedStart) && Number.isFinite(requestedEnd) && requestedStart < requestedEnd;
const endMinute = fixedWindow
  ? Math.trunc(requestedEnd)
  : Math.floor((Date.now() - recentGuardMs) / minuteMs) * minuteMs;
const startMinute = fixedWindow ? Math.trunc(requestedStart) : endMinute - windowMs;

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

function anomalyLabel(reason) {
  if (reason === 'implausibly_low_listener') return '極端な低同接';
  if (reason === 'local_listener_collapse') return '前後から孤立した急落';
  if (reason === 'missing_or_invalid_listener') return '放送中の欠損/不正値';
  return reason;
}

const sql = `SELECT id,minute_at,listener_count,is_broadcasting
FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
WHERE source_code=1 AND channel_id=${channelId}
  AND minute_at>=${startMinute} AND minute_at<${endMinute}
ORDER BY minute_at ASC,id ASC`;
const factRows = rows(parse(wrangler([
  'd1', 'execute', databaseName, '--remote', '--yes', '--json', '--command', sql,
])));
const expectedMinutes = Math.max(0, Math.trunc((endMinute - startMinute) / minuteMs));
const distinctMinutes = new Set(factRows.map((row) => Number(row.minute_at)).filter(Number.isFinite));
const orderedMinutes = [...distinctMinutes].sort((left, right) => left - right);
const listenerAudit = auditListenerAnomalies(factRows);
const hasMinuteGaps = distinctMinutes.size < expectedMinutes;
const hasListenerAnomaly = listenerAudit.anomaly_count > 0;
const summary = {
  database_name: databaseName,
  channel_id: channelId,
  window_start_ms: startMinute,
  window_end_ms: endMinute,
  window_start: new Date(startMinute).toISOString(),
  window_end: new Date(endMinute).toISOString(),
  expected_minute_count: expectedMinutes,
  row_count: factRows.length,
  distinct_minute_count: distinctMinutes.size,
  first_minute_at: orderedMinutes[0] ?? null,
  last_minute_at: orderedMinutes.at(-1) ?? null,
  broadcast_sample_count: listenerAudit.broadcast_sample_count,
  broadcast_listener_median: listenerAudit.broadcast_median,
  listener_anomaly_count: listenerAudit.anomaly_count,
  hard_low_listener_count: listenerAudit.hard_low_count,
  local_listener_collapse_count: listenerAudit.local_collapse_count,
  invalid_listener_count: listenerAudit.invalid_listener_count,
  listener_anomalies: listenerAudit.anomalies.slice(0, 20),
  has_minute_gaps: hasMinuteGaps,
  has_listener_anomaly: hasListenerAnomaly,
};
summary.needs_repair = hasMinuteGaps || hasListenerAnomaly;

console.log(JSON.stringify(summary));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `needs_repair=${summary.needs_repair}\n`
    + `has_minute_gaps=${summary.has_minute_gaps}\n`
    + `has_listener_anomaly=${summary.has_listener_anomaly}\n`
    + `listener_anomaly_count=${summary.listener_anomaly_count}\n`
    + `hard_low_listener_count=${summary.hard_low_listener_count}\n`
    + `window_start_ms=${startMinute}\nwindow_end_ms=${endMinute}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  let report = `\n## Stationhead minute facts — last 24 hours\n\n`
    + `- Channel: **${channelId}**\n`
    + `- Rows: **${summary.row_count}**\n`
    + `- Distinct minutes: **${summary.distinct_minute_count} / ${expectedMinutes}**\n`
    + `- Broadcasting listener samples: **${summary.broadcast_sample_count}**\n`
    + `- Broadcasting listener median: **${summary.broadcast_listener_median ?? '—'}**\n`
    + `- Listener anomalies: **${summary.listener_anomaly_count}**`
    + ` (≤15: ${summary.hard_low_listener_count}, local collapse: ${summary.local_listener_collapse_count}, invalid: ${summary.invalid_listener_count})\n`
    + `- Repair required: **${summary.needs_repair}**\n`
    + `- Window: ${summary.window_start} → ${summary.window_end}\n`;
  if (summary.listener_anomalies.length) {
    report += '\n### Listener anomaly candidates\n\n| Time (UTC) | Listeners | Reason | Local median |\n| --- | ---: | --- | ---: |\n';
    for (const anomaly of summary.listener_anomalies) {
      report += `| ${new Date(anomaly.minute_at).toISOString()} | ${anomaly.listener_count ?? '—'} | ${anomalyLabel(anomaly.reason)} | ${anomaly.local_median ?? '—'} |\n`;
    }
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
