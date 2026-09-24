import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseMaximumAge,
} from '../site/functions/lib/api-contract.js';
import {
  DAILY_EXPECTED_SAMPLE_COUNT,
  DAILY_MINIMUM_SAMPLE_COUNT,
  KNOWN_DAILY_STREAM_GAPS,
  parseQualityFlags,
} from '../site/functions/lib/period-completeness.js';
import { isKnownMissingPeriod } from '../site/functions/lib/known-history-gap.js';

const MATERIALIZED_SOURCES = new Set(['actions-r2', 'worker-r2', 'worker-kv', 'edge-cache']);
const DAY_MS = 86_400_000;
const MAX_REPORTED_GAPS = 24;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:') throw new Error(`Materialized audit URL must use HTTPS: ${value}`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseArgs(argv) {
  const options = {
    baseUrl: 'https://skrzk.pages.dev',
    attempts: 3,
    retryDelayMs: 5_000,
    outPath: '.pages-production-audit/materialized.json',
  };

  for (const arg of argv) {
    if (arg.startsWith('--url=')) options.baseUrl = normalizeBaseUrl(arg.slice('--url='.length));
    else if (arg.startsWith('--attempts=')) options.attempts = Number(arg.slice('--attempts='.length));
    else if (arg.startsWith('--retry-delay-ms=')) options.retryDelayMs = Number(arg.slice('--retry-delay-ms='.length));
    else if (arg.startsWith('--out=')) options.outPath = arg.slice('--out='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 10) {
    throw new Error('--attempts must be an integer between 1 and 10');
  }
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0 || options.retryDelayMs > 60_000) {
    throw new Error('--retry-delay-ms must be between 0 and 60000');
  }
  return options;
}

function timestampHeader(headers, name) {
  const value = headers.get(name);
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function realIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text;
}

function realIsoMonth(value) {
  const text = String(value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return false;
  const parsed = Date.parse(`${text}-01T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 7) === text;
}

function nextPeriodKey(mode, key) {
  if (mode === 'monthly') {
    if (!realIsoMonth(key)) return null;
    const date = new Date(`${key}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 7);
  }
  if (!realIsoDate(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (mode === 'weekly' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

function currentPeriodKey(mode, now) {
  const date = new Date(now);
  if (mode === 'monthly') return date.toISOString().slice(0, 7);
  if (mode === 'weekly') {
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function previousUtcDay(now) {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return new Date(start - DAY_MS).toISOString().slice(0, 10);
}

function gapKeys(keys, mode) {
  const unique = [...new Set(keys)].sort();
  const missing = [];
  for (let index = 1; index < unique.length; index += 1) {
    let cursor = nextPeriodKey(mode, unique[index - 1]);
    let guard = 0;
    while (cursor && cursor < unique[index] && guard < 2_000) {
      missing.push(cursor);
      if (missing.length >= MAX_REPORTED_GAPS) return missing;
      cursor = nextPeriodKey(mode, cursor);
      guard += 1;
    }
  }
  return missing;
}

function appendMissingThrough(keys, mode, expectedLatest, missing) {
  if (!keys.length || !expectedLatest) return missing;
  let cursor = nextPeriodKey(mode, keys.at(-1));
  let guard = 0;
  while (cursor && cursor <= expectedLatest && guard < 2_000) {
    if (!missing.includes(cursor)) missing.push(cursor);
    if (missing.length >= MAX_REPORTED_GAPS) break;
    cursor = nextPeriodKey(mode, cursor);
    guard += 1;
  }
  return missing;
}

function auditSummaryRows(payload, mode, options = {}) {
  const failures = [];
  const warnings = [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : null;
  if (!rows) {
    return {
      checked: true,
      count: null,
      latestKey: null,
      gapCount: null,
      incompleteCount: null,
      failures: ['rows is missing or is not an array'],
      warnings,
    };
  }
  if (!rows.length) failures.push('rows is empty');

  const validKey = mode === 'monthly' ? realIsoMonth : realIsoDate;
  const keys = [];
  const seen = new Set();
  let incompleteCount = 0;
  for (const row of rows) {
    const key = String(row?.period_key || '');
    if (!validKey(key)) {
      failures.push(`invalid period_key: ${key || 'missing'}`);
      continue;
    }
    if (seen.has(key)) failures.push(`duplicate period_key: ${key}`);
    seen.add(key);
    keys.push(key);

    const current = key === currentPeriodKey(mode, options.materializedAt ?? options.now ?? Date.now());
    const declaredMissing = row?.known_missing === true && isKnownMissingPeriod(mode, key);
    if (row?.period_complete === false) {
      incompleteCount += 1;
      const reasons = Array.isArray(row?.exclusion_reasons)
        ? row.exclusion_reasons.join(',')
        : parseQualityFlags(row?.quality_flags).join(',');
      if (declaredMissing || (mode === 'daily' && KNOWN_DAILY_STREAM_GAPS.has(key)) || current || mode !== 'daily') {
        warnings.push(`${key} is incomplete${reasons ? ` (${reasons})` : ''}`);
      } else {
        failures.push(`${key} is incomplete${reasons ? ` (${reasons})` : ''}`);
      }
    }

    if (mode === 'daily') {
      if (declaredMissing) {
        if (row.sample_count !== '-' || row.reliable_sample_count !== '-') {
          failures.push(`${key} has inconsistent known-missing sample counts`);
        }
        continue;
      }
      const sampleCount = Number(row?.sample_count);
      const reliableSampleCount = Number(row?.reliable_sample_count);
      if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > DAILY_EXPECTED_SAMPLE_COUNT) {
        failures.push(`${key} has invalid sample_count: ${row?.sample_count}`);
      } else if (sampleCount < DAILY_MINIMUM_SAMPLE_COUNT) {
        const message = `${key} has only ${sampleCount}/${DAILY_EXPECTED_SAMPLE_COUNT} minute samples`;
        if (KNOWN_DAILY_STREAM_GAPS.has(key)) warnings.push(message);
        else failures.push(message);
      }
      if (!Number.isInteger(reliableSampleCount)
          || reliableSampleCount < 0
          || reliableSampleCount > sampleCount) {
        failures.push(`${key} has invalid reliable_sample_count: ${row?.reliable_sample_count}`);
      }
    }
  }

  keys.sort();
  const missing = gapKeys(keys, mode);
  if (mode === 'daily' && keys.length) {
    const freshnessAnchor = Number(options.materializedAt ?? options.now ?? Date.now());
    if (Number.isFinite(freshnessAnchor) && freshnessAnchor > 0) {
      appendMissingThrough(keys, mode, previousUtcDay(freshnessAnchor), missing);
    }
  }
  for (const key of missing) {
    if (mode === 'daily' && !KNOWN_DAILY_STREAM_GAPS.has(key)) failures.push(`missing ${mode} period: ${key}`);
    else warnings.push(`missing ${mode} period: ${key}${mode === 'daily' ? ' (known collection gap)' : ''}`);
  }

  return {
    checked: true,
    count: rows.length,
    latestKey: keys.at(-1) || null,
    gapCount: missing.length,
    incompleteCount,
    failures: [...new Set(failures)],
    warnings: [...new Set(warnings)],
  };
}

function auditBroadcastRows(payload) {
  const failures = [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : null;
  if (!rows) {
    return { checked: true, count: null, latestKey: null, gapCount: null, incompleteCount: null, failures: ['rows is missing or is not an array'], warnings: [] };
  }
  if (!rows.length) {
    failures.push(payload?.setup_required === true
      ? 'broadcast history is empty and setup_required=true'
      : 'broadcast history is empty');
  }
  for (const row of rows) {
    if (!Number.isFinite(Number(row?.started_at))) failures.push(`broadcast row has invalid started_at: ${row?.started_at}`);
    const sampleCount = Number(row?.sample_count);
    if (!Number.isFinite(sampleCount) || sampleCount < 1) failures.push(`broadcast row has invalid sample_count: ${row?.sample_count}`);
  }
  const latest = [...rows]
    .map((row) => Number(row?.started_at))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
    .at(-1);
  return {
    checked: true,
    count: rows.length,
    latestKey: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    gapCount: 0,
    incompleteCount: 0,
    failures: [...new Set(failures)],
    warnings: [],
  };
}

function auditHostSummary(payload) {
  const failures = [];
  const recent = Array.isArray(payload?.sakurazaka46jp_recent_sessions)
    ? payload.sakurazaka46jp_recent_sessions
    : null;
  if (!recent) failures.push('sakurazaka46jp_recent_sessions is missing or is not an array');
  else if (!recent.length) failures.push('sakurazaka46jp_recent_sessions is empty');
  const latestStartedAt = Number(recent?.[0]?.started_at);
  if (recent?.length && !Number.isFinite(latestStartedAt)) {
    failures.push(`latest host session has invalid started_at: ${recent[0]?.started_at}`);
  }
  return {
    checked: true,
    count: recent?.length ?? null,
    latestKey: Number.isFinite(latestStartedAt) ? new Date(latestStartedAt).toISOString() : null,
    gapCount: 0,
    incompleteCount: 0,
    failures,
    warnings: [],
  };
}

export function auditPayloadCompleteness(modelKey, payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      checked: false,
      count: null,
      latestKey: null,
      gapCount: null,
      incompleteCount: null,
      failures: [],
      warnings: [],
    };
  }
  if (modelKey === 'history:daily') return auditSummaryRows(payload, 'daily', options);
  if (modelKey === 'history:weekly') return auditSummaryRows(payload, 'weekly', options);
  if (modelKey === 'history:monthly') return auditSummaryRows(payload, 'monthly', options);
  if (modelKey === 'history:broadcasts') return auditBroadcastRows(payload);
  if (modelKey === 'host-history:summary') return auditHostSummary(payload);
  return {
    checked: false,
    count: null,
    latestKey: null,
    gapCount: null,
    incompleteCount: null,
    failures: [],
    warnings: [],
  };
}

async function auditMaterializedVariant(baseUrl, variant, options = {}) {
  const now = Number(options.now ?? Date.now());
  const url = new URL(variant.url, `${normalizeBaseUrl(baseUrl)}/`);
  url.searchParams.set('v', String(now));
  const maximumAgeMs = materializedResponseMaximumAge(variant.key, options.env || {});
  const failures = [];
  const warnings = [];
  let status = null;
  let payload = null;
  let error = null;
  let source = null;
  let materializedAt = null;
  let fallback = null;
  let edgeCache = null;
  let dataIntegrity = null;

  try {
    const response = await (options.fetch || fetch)(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    status = response.status;
    source = response.headers.get('x-api-source');
    fallback = response.headers.get('x-materialized-fallback');
    edgeCache = response.headers.get('x-edge-cache');
    materializedAt = timestampHeader(response.headers, 'x-materialized-at');
    payload = await response.json().catch(() => null);

    if (!response.ok) failures.push(`${variant.key} returned HTTP ${response.status}`);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      failures.push(`${variant.key} did not return a JSON object`);
    } else if (payload.ok !== true) {
      failures.push(`${variant.key} payload did not return { ok: true }`);
    }
    if (fallback) failures.push(`${variant.key} used fallback path: ${fallback}`);
    if (!MATERIALIZED_SOURCES.has(String(source || ''))) {
      failures.push(`${variant.key} did not identify a materialized source: ${source || 'missing'}`);
    }
    if (materializedAt == null) {
      failures.push(`${variant.key} did not include a valid x-materialized-at header`);
    } else if (now - materializedAt > maximumAgeMs) {
      failures.push(`${variant.key} is stale by ${now - materializedAt - maximumAgeMs} ms`);
    }

    dataIntegrity = auditPayloadCompleteness(variant.key, payload, { now, materializedAt });
    for (const failure of dataIntegrity.failures) failures.push(`${variant.key} data: ${failure}`);
    for (const warning of dataIntegrity.warnings) warnings.push(`${variant.key} data: ${warning}`);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    failures.push(`${variant.key} request failed: ${error}`);
  }

  return {
    key: variant.key,
    url: url.toString(),
    status,
    source,
    materializedAt,
    materializedAgeMs: materializedAt == null ? null : Math.max(0, now - materializedAt),
    maximumAgeMs,
    fallback,
    edgeCache,
    payloadOk: Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && payload.ok === true),
    dataIntegrity,
    error,
    warnings,
    failures,
    ok: failures.length === 0,
  };
}

export async function auditMaterializedDashboard(baseUrl, options = {}) {
  const dashboard = MATERIALIZED_API_VARIANTS.find(({ key }) => key === 'dashboard');
  return auditMaterializedVariant(baseUrl, dashboard, options);
}

export async function auditMaterializedPages(baseUrl, options = {}) {
  const now = Number(options.now ?? Date.now());
  const variants = [];
  for (const variant of MATERIALIZED_API_VARIANTS) {
    variants.push(await auditMaterializedVariant(baseUrl, variant, { ...options, now }));
  }
  return {
    generatedAt: new Date(now).toISOString(),
    baseUrl: normalizeBaseUrl(baseUrl),
    variants,
    warnings: variants.flatMap((variant) => variant.warnings),
    failures: variants.flatMap((variant) => variant.failures),
    ok: variants.every((variant) => variant.ok),
  };
}

function markdownSummary(report) {
  const lines = [
    '## Pages materialized API audit',
    '',
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    '- Data completeness reuses these already-fetched materialized responses; it performs no additional D1 reads or writes.',
    '',
    '| Model | HTTP | Source | Age | Max age | Fallback | Result |',
    '| --- | ---: | --- | ---: | ---: | --- | :---: |',
  ];
  for (const variant of report.variants) {
    const age = variant.materializedAgeMs == null ? '-' : `${variant.materializedAgeMs} ms`;
    lines.push(`| ${variant.key} | ${variant.status ?? '-'} | ${variant.source || '-'} | ${age} | ${variant.maximumAgeMs} ms | ${variant.fallback || 'none'} | ${variant.ok ? 'PASS' : 'FAIL'} |`);
  }

  const checked = report.variants.filter((variant) => variant.dataIntegrity?.checked);
  if (checked.length) {
    lines.push(
      '',
      '### Pages data completeness',
      '',
      '| Model | Rows/items | Latest | Missing periods | Incomplete periods |',
      '| --- | ---: | --- | ---: | ---: |',
    );
    for (const variant of checked) {
      const integrity = variant.dataIntegrity;
      lines.push(`| ${variant.key} | ${integrity.count ?? '-'} | ${integrity.latestKey || '-'} | ${integrity.gapCount ?? '-'} | ${integrity.incompleteCount ?? '-'} |`);
    }
  }
  if (report.warnings.length) lines.push('', '### Data warnings', '', ...report.warnings.map((warning) => `- ${warning}`));
  if (report.failures.length) lines.push('', '### Failures', '', ...report.failures.map((failure) => `- ${failure}`));
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let report;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    report = await auditMaterializedPages(options.baseUrl);
    report.attempt = attempt;
    report.attempts = options.attempts;
    if (report.ok || attempt === options.attempts) break;
    await sleep(options.retryDelayMs);
  }

  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const summary = markdownSummary(report);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
