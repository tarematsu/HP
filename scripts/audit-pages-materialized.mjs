import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseMaximumAge,
} from '../site/functions/lib/api-contract.js';

const MATERIALIZED_SOURCES = new Set(['actions-r2', 'worker-r2', 'worker-kv', 'edge-cache']);
const MAX_DAILY_MINUTE_SAMPLES = 1_440;

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

function auditDailyRows(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : null;
  if (!rows) {
    return {
      rowCount: null,
      maxSampleCount: null,
      invalidRows: [{ period_key: null, reason: 'rows-missing' }],
    };
  }

  let maxSampleCount = 0;
  const invalidRows = [];
  for (const row of rows) {
    const sampleCount = Number(row?.sample_count);
    const reliableSampleCount = Number(row?.reliable_sample_count);
    if (Number.isInteger(sampleCount)) maxSampleCount = Math.max(maxSampleCount, sampleCount);
    if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > MAX_DAILY_MINUTE_SAMPLES) {
      invalidRows.push({
        period_key: row?.period_key || null,
        sample_count: row?.sample_count ?? null,
        reliable_sample_count: row?.reliable_sample_count ?? null,
        reason: 'sample-count-out-of-range',
      });
      continue;
    }
    if (!Number.isInteger(reliableSampleCount)
        || reliableSampleCount < 0
        || reliableSampleCount > sampleCount) {
      invalidRows.push({
        period_key: row?.period_key || null,
        sample_count: sampleCount,
        reliable_sample_count: row?.reliable_sample_count ?? null,
        reason: 'reliable-sample-count-out-of-range',
      });
    }
  }
  return { rowCount: rows.length, maxSampleCount, invalidRows };
}

async function auditMaterializedVariant(baseUrl, variant, options = {}) {
  const now = Number(options.now ?? Date.now());
  const url = new URL(variant.url, `${normalizeBaseUrl(baseUrl)}/`);
  url.searchParams.set('v', String(now));
  const maximumAgeMs = materializedResponseMaximumAge(variant.key, options.env || {});
  const failures = [];
  let status = null;
  let payload = null;
  let error = null;
  let source = null;
  let materializedAt = null;
  let fallback = null;
  let edgeCache = null;
  let dailyIntegrity = null;

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
    if (variant.key === 'history:daily' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      dailyIntegrity = auditDailyRows(payload);
      for (const row of dailyIntegrity.invalidRows) {
        failures.push(`history:daily invalid ${row.period_key || 'unknown'}: ${row.reason}`);
      }
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
    dailyIntegrity,
    error,
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
    failures: variants.flatMap((variant) => variant.failures),
    ok: variants.every((variant) => variant.ok),
  };
}

function markdownSummary(report) {
  const lines = [
    '## Pages materialized API audit',
    '',
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '| Model | HTTP | Source | Age | Max age | Fallback | Result |',
    '| --- | ---: | --- | ---: | ---: | --- | :---: |',
  ];
  for (const variant of report.variants) {
    const age = variant.materializedAgeMs == null ? '-' : `${variant.materializedAgeMs} ms`;
    lines.push(`| ${variant.key} | ${variant.status ?? '-'} | ${variant.source || '-'} | ${age} | ${variant.maximumAgeMs} ms | ${variant.fallback || 'none'} | ${variant.ok ? 'PASS' : 'FAIL'} |`);
  }
  const daily = report.variants.find(({ key }) => key === 'history:daily')?.dailyIntegrity;
  if (daily) {
    lines.push(
      '',
      '### Daily data integrity',
      '',
      `- Rows checked: ${daily.rowCount ?? '-'}`,
      `- Maximum sample_count: ${daily.maxSampleCount ?? '-'} / ${MAX_DAILY_MINUTE_SAMPLES}`,
      `- Invalid rows: ${daily.invalidRows.length}`,
    );
  }
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
