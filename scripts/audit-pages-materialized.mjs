import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MATERIALIZED_SOURCES = new Set(['actions-r2', 'worker-r2', 'worker-kv', 'edge-cache']);

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

export async function auditMaterializedDashboard(baseUrl, options = {}) {
  const now = Number(options.now ?? Date.now());
  const url = new URL('/api/dashboard', `${normalizeBaseUrl(baseUrl)}/`);
  url.searchParams.set('v', String(now));
  const failures = [];
  let status = null;
  let payload = null;
  let error = null;
  let source = null;
  let materializedAt = null;
  let fallback = null;
  let edgeCache = null;

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
    materializedAt = Number(response.headers.get('x-materialized-at'));
    payload = await response.json().catch(() => null);

    if (!response.ok) failures.push(`dashboard endpoint returned HTTP ${response.status}`);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      failures.push('dashboard endpoint did not return a JSON object');
    }
    if (fallback) failures.push(`dashboard used fallback path: ${fallback}`);
    if (!MATERIALIZED_SOURCES.has(String(source || ''))) {
      failures.push(`dashboard did not identify a materialized source: ${source || 'missing'}`);
    }
    if (!Number.isFinite(materializedAt) || materializedAt <= 0) {
      failures.push('dashboard did not include a valid x-materialized-at header');
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    failures.push(`dashboard request failed: ${error}`);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    url: url.toString(),
    status,
    source,
    materializedAt: Number.isFinite(materializedAt) ? materializedAt : null,
    materializedAgeMs: Number.isFinite(materializedAt) ? Math.max(0, now - materializedAt) : null,
    fallback,
    edgeCache,
    payloadOk: Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)),
    error,
    failures,
    ok: failures.length === 0,
  };
}

function markdownSummary(report) {
  return [
    '## Pages materialized dashboard audit',
    '',
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- HTTP: ${report.status ?? '-'}`,
    `- Source: ${report.source || '-'}`,
    `- Materialized age: ${report.materializedAgeMs == null ? '-' : `${report.materializedAgeMs} ms`}`,
    `- Edge cache: ${report.edgeCache || '-'}`,
    `- Fallback: ${report.fallback || 'none'}`,
    ...(report.failures.length ? ['', ...report.failures.map((failure) => `- ${failure}`)] : []),
    '',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let report;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    report = await auditMaterializedDashboard(options.baseUrl);
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
