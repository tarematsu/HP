import { readFile, writeFile } from 'node:fs/promises';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const GRAPHQL_URL = `${API_BASE}/graphql`;
const DEFAULT_HOURS = 6;
const MAX_HOURS = 24 * 30;
const DEFAULT_TARGET_MS = 10;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function microsecondsToMilliseconds(value) {
  return numeric(value) / 1000;
}

function maximumRow(rows, selector) {
  let selected = null;
  let selectedValue = -Infinity;
  for (const row of rows) {
    const value = numeric(selector(row));
    if (value <= selectedValue) continue;
    selected = row;
    selectedValue = value;
  }
  return selected ? { row: selected, value: selectedValue } : null;
}

export function summarizeWorkerCpuRows(rows, options = {}) {
  const normalized = Array.isArray(rows) ? rows : [];
  const targetMs = numeric(options.targetMs || DEFAULT_TARGET_MS);
  const totals = normalized.reduce((sum, row) => {
    sum.requests += numeric(row?.sum?.requests);
    sum.errors += numeric(row?.sum?.errors);
    sum.subrequests += numeric(row?.sum?.subrequests);
    return sum;
  }, { requests: 0, errors: 0, subrequests: 0 });
  const p50 = maximumRow(normalized, (row) => row?.quantiles?.cpuTimeP50);
  const p99 = maximumRow(normalized, (row) => row?.quantiles?.cpuTimeP99);
  const statusRequests = {};
  for (const row of normalized) {
    const status = String(row?.dimensions?.status || 'unknown');
    statusRequests[status] = (statusRequests[status] || 0) + numeric(row?.sum?.requests);
  }
  const maxP50Us = p50?.value ?? null;
  const maxP99Us = p99?.value ?? null;
  const maxP50Ms = maxP50Us == null ? null : microsecondsToMilliseconds(maxP50Us);
  const maxP99Ms = maxP99Us == null ? null : microsecondsToMilliseconds(maxP99Us);
  return {
    hasData: normalized.length > 0,
    rowCount: normalized.length,
    totals,
    statusRequests,
    targetMs,
    maxBucketP50: p50 ? {
      microseconds: maxP50Us,
      milliseconds: maxP50Ms,
      datetime: p50.row?.dimensions?.datetime || null,
      status: p50.row?.dimensions?.status || null
    } : null,
    maxBucketP99: p99 ? {
      microseconds: maxP99Us,
      milliseconds: maxP99Ms,
      datetime: p99.row?.dimensions?.datetime || null,
      status: p99.row?.dimensions?.status || null
    } : null,
    maxBucketP99AtOrBelowTarget: maxP99Ms == null ? null : maxP99Ms <= targetMs
  };
}

function formatMs(value) {
  return value == null ? 'n/a' : `${value.toFixed(3)} ms`;
}

export function buildWorkerCpuMarkdown(report) {
  const summary = report.summary;
  const lines = [
    '# Cloudflare Worker CPU report',
    '',
    `- Worker: \`${report.workerName}\``,
    `- Window: ${report.datetimeStart} to ${report.datetimeEnd}`,
    `- GraphQL rows: ${summary.rowCount}`,
    `- Requests: ${summary.totals.requests}`,
    `- Errors: ${summary.totals.errors}`,
    `- Subrequests: ${summary.totals.subrequests}`,
    `- Maximum bucket P50: ${formatMs(summary.maxBucketP50?.milliseconds)}`,
    `- Maximum bucket P99: ${formatMs(summary.maxBucketP99?.milliseconds)}`,
    `- Target: ${summary.targetMs.toFixed(3)} ms`,
    `- Maximum bucket P99 <= target: ${summary.maxBucketP99AtOrBelowTarget == null ? 'no data' : summary.maxBucketP99AtOrBelowTarget}`,
    '',
    'CPU values are Cloudflare invocation CPU microseconds converted to milliseconds.',
    'This is sampled aggregate analytics. It does not prove that every route or every invocation stayed below the target.'
  ];
  if (summary.maxBucketP99?.datetime) {
    lines.push('', `Peak P99 bucket: ${summary.maxBucketP99.datetime} (${summary.maxBucketP99.status || 'unknown'})`);
  }
  return `${lines.join('\n')}\n`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function configWorkerName() {
  try {
    const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
    return String(config?.name || '');
  } catch {
    return '';
  }
}

async function cloudflare(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const details = (payload?.errors || [])
      .map((error) => `${error.code || 'unknown'}:${error.message || 'Cloudflare API error'}`)
      .join(', ');
    throw new Error(`Cloudflare API ${response.status}: ${details || 'request failed'}`);
  }
  return payload;
}

async function resolveAccountIds(token, configuredAccountId) {
  if (configuredAccountId) return [configuredAccountId];
  const payload = await cloudflare('/accounts?per_page=50', token);
  const ids = (payload?.result || [])
    .map((account) => String(account?.id || ''))
    .filter(Boolean);
  if (!ids.length) throw new Error('No Cloudflare account is available to the API token');
  return ids;
}

async function queryWorkerRows(token, accountId, variables) {
  const query = `query WorkerCpu($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(limit: 10000, filter: {
          scriptName: $scriptName,
          datetime_geq: $datetimeStart,
          datetime_leq: $datetimeEnd
        }) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
          dimensions { datetime scriptName status }
        }
      }
    }
  }`;
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables: { ...variables, accountTag: accountId }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errors?.length) {
    const details = (payload?.errors || [])
      .map((error) => error?.message || 'GraphQL error')
      .join(', ');
    throw new Error(`Cloudflare GraphQL ${response.status}: ${details || 'request failed'}`);
  }
  return payload?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '');
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not configured');
  const workerName = String(
    args.worker
    || process.env.CLOUDFLARE_WORKER_NAME
    || process.env.WORKER_NAME
    || await configWorkerName()
  );
  if (!workerName) throw new Error('Worker name is not configured');
  const hours = Math.min(MAX_HOURS, Math.max(1, Math.floor(numeric(args.hours || DEFAULT_HOURS))));
  const targetMs = Math.max(0, numeric(args['target-ms'] || DEFAULT_TARGET_MS));
  const datetimeEnd = args.end ? new Date(args.end) : new Date();
  if (!Number.isFinite(datetimeEnd.getTime())) throw new Error('Invalid report end time');
  const datetimeStart = new Date(datetimeEnd.getTime() - hours * 60 * 60 * 1000);
  const variables = {
    datetimeStart: datetimeStart.toISOString(),
    datetimeEnd: datetimeEnd.toISOString(),
    scriptName: workerName
  };
  const accountIds = await resolveAccountIds(
    token,
    String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  );
  let selected = null;
  for (const accountId of accountIds) {
    const rows = await queryWorkerRows(token, accountId, variables);
    if (!selected || rows.length > selected.rows.length) selected = { accountId, rows };
    if (rows.length) break;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    accountId: selected?.accountId || accountIds[0],
    workerName,
    datetimeStart: variables.datetimeStart,
    datetimeEnd: variables.datetimeEnd,
    cpuUnit: 'microseconds',
    summary: summarizeWorkerCpuRows(selected?.rows || [], { targetMs }),
    rows: selected?.rows || []
  };
  const markdown = buildWorkerCpuMarkdown(report);
  await writeFile(args['out-json'] || 'worker-cpu-report.json', `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(args['out-markdown'] || 'worker-cpu-report.md', markdown);
  process.stdout.write(markdown);
  const failAboveMs = numeric(args['fail-above-ms'] || process.env.CPU_REPORT_FAIL_ABOVE_MS);
  if (failAboveMs > 0 && report.summary.maxBucketP99?.milliseconds > failAboveMs) {
    throw new Error(`Maximum bucket CPU P99 ${report.summary.maxBucketP99.milliseconds.toFixed(3)} ms exceeds ${failAboveMs} ms`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
