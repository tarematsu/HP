#!/usr/bin/env node

import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_OUTPUT = 'stationhead-leaderboard-probe-status.json';
const ALLOWED_STAGES = new Set([
  'no_status',
  'waiting_for_probe',
  'native_spooled',
  'cloud_received',
  'cloud_stored_dispatch_pending',
  'reported_awaiting_ack',
  'idle_after_report',
  'cloud_error',
]);
const ALLOWED_ERRORS = new Set(['none', 'invalid', 'unavailable']);

function safeInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : false;
}

function safeIsoTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 40) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function sanitizeLeaderboardProbeStatus(value) {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const native = root.native && typeof root.native === 'object' && !Array.isArray(root.native)
    ? root.native
    : {};
  const cloud = root.cloud && typeof root.cloud === 'object' && !Array.isArray(root.cloud)
    ? root.cloud
    : {};
  const history = root.history && typeof root.history === 'object' && !Array.isArray(root.history)
    ? root.history
    : {};
  const stage = typeof root.stage === 'string' && ALLOWED_STAGES.has(root.stage)
    ? root.stage
    : 'unknown';
  const error = typeof cloud.error === 'string' && ALLOWED_ERRORS.has(cloud.error)
    ? cloud.error
    : 'unknown';

  return {
    version: root.version === 1 ? 1 : null,
    updated_at: safeIsoTimestamp(root.updated_at),
    stage,
    native: {
      spool_records: safeInteger(native.spool_records, 20),
      batch_records: safeInteger(native.batch_records, 8),
    },
    cloud: {
      reached: safeBoolean(cloud.reached),
      probe_submitted: safeBoolean(cloud.probe_submitted),
      accepted: safeInteger(cloud.accepted, 8) ?? 0,
      stored: safeBoolean(cloud.stored),
      dispatch_ok: safeBoolean(cloud.dispatch_ok),
      error,
    },
    history: {
      last_probe_received_at: safeIsoTimestamp(history.last_probe_received_at),
      last_stored_at: safeIsoTimestamp(history.last_stored_at),
      last_reported_at: safeIsoTimestamp(history.last_reported_at),
    },
  };
}

function validatedUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:') throw new Error('diagnostic URL must use HTTPS');
  if (!url.hostname.endsWith('.workers.dev')) throw new Error('diagnostic URL must be a workers.dev endpoint');
  if (url.pathname !== '/api/health/stationhead-leaderboard-probe') {
    throw new Error('unexpected diagnostic path');
  }
  return url.toString();
}

export async function captureLeaderboardProbeStatus({
  url,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const endpoint = validatedUrl(url);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  let httpStatus = null;
  try {
    const response = await fetchImpl(endpoint, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    httpStatus = response.status;
    let parsed;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      return {
        version: 1,
        captured_at: now().toISOString(),
        fetch_ok: false,
        http_status: httpStatus,
        error: 'invalid_json',
        diagnostic: null,
      };
    }
    return {
      version: 1,
      captured_at: now().toISOString(),
      fetch_ok: response.ok,
      http_status: httpStatus,
      error: response.ok ? null : 'http_error',
      diagnostic: sanitizeLeaderboardProbeStatus(parsed),
    };
  } catch {
    return {
      version: 1,
      captured_at: now().toISOString(),
      fetch_ok: false,
      http_status: httpStatus,
      error: 'request_failed',
      diagnostic: null,
    };
  }
}

function summaryMarkdown(result) {
  const diagnostic = result.diagnostic;
  const rows = [
    ['Capture', result.fetch_ok ? 'ok' : result.error || 'failed'],
    ['HTTP', result.http_status ?? '-'],
    ['Stage', diagnostic?.stage ?? '-'],
    ['Spool records', diagnostic?.native?.spool_records ?? '-'],
    ['Batch records', diagnostic?.native?.batch_records ?? '-'],
    ['Cloud reached', diagnostic?.cloud?.reached ?? false],
    ['Probe submitted', diagnostic?.cloud?.probe_submitted ?? false],
    ['Accepted', diagnostic?.cloud?.accepted ?? 0],
    ['Stored', diagnostic?.cloud?.stored ?? false],
    ['Dispatch OK', diagnostic?.cloud?.dispatch_ok ?? false],
    ['Last probe received', diagnostic?.history?.last_probe_received_at ?? '-'],
    ['Last stored', diagnostic?.history?.last_stored_at ?? '-'],
    ['Last reported', diagnostic?.history?.last_reported_at ?? '-'],
  ];
  return [
    '### Stationhead leaderboard probe',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([key, value]) => `| ${key} | ${String(value)} |`),
    '',
  ].join('\n');
}

async function main() {
  const url = process.argv[2] || process.env.STATIONHEAD_LEADERBOARD_PROBE_STATUS_URL;
  const output = process.env.STATIONHEAD_LEADERBOARD_PROBE_STATUS_OUTPUT || DEFAULT_OUTPUT;
  const result = await captureLeaderboardProbeStatus({ url });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  const summaryPath = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
  if (summaryPath) await appendFile(summaryPath, summaryMarkdown(result), 'utf8');

  const diagnostic = result.diagnostic;
  console.log([
    'STATIONHEAD_LEADERBOARD_PROBE_STATUS',
    `fetch_ok=${result.fetch_ok}`,
    `http_status=${result.http_status ?? 'none'}`,
    `stage=${diagnostic?.stage ?? 'none'}`,
    `spool=${diagnostic?.native?.spool_records ?? 'none'}`,
    `batch=${diagnostic?.native?.batch_records ?? 'none'}`,
    `dispatch_ok=${diagnostic?.cloud?.dispatch_ok ?? false}`,
  ].join(' '));

  if (!result.fetch_ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Capture leaderboard probe status::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 500)}`);
    process.exitCode = 1;
  });
}
