import { readFile, writeFile } from 'node:fs/promises';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const DEFAULT_HOURS = 6;
const DEFAULT_TARGET_MS = 10;
const DEFAULT_PAGE_SIZE = 2000;
const DEFAULT_MAX_EVENTS = 10_000;
const MAX_HOURS = 24 * 30;
const MAX_PAGE_SIZE = 2000;
const MAX_TEXT_LENGTH = 160;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Math.floor(numeric(value));
  return parsed >= min ? Math.min(max, parsed) : fallback;
}

function trimmedText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function safeInvocationTrigger(value) {
  const text = trimmedText(value);
  const query = text.indexOf('?');
  return query >= 0 ? text.slice(0, query) : text;
}

export function isObservabilityAuthorizationError(error) {
  return /Cloudflare API 403:.*(?:10000:Authentication error|Authentication error)/i
    .test(String(error?.message || error || ''));
}

export function percentile(values, quantile) {
  const sorted = values
    .map(numeric)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const bounded = Math.min(1, Math.max(0, numeric(quantile)));
  const index = Math.max(0, Math.ceil(bounded * sorted.length) - 1);
  return sorted[index];
}

export function telemetryQueryBody(options = {}) {
  const filters = [
    {
      key: '$workers.scriptName',
      operation: 'eq',
      type: 'string',
      value: String(options.workerName || '')
    },
    {
      key: '$workers.cpuTimeMs',
      operation: 'exists',
      type: 'number'
    }
  ];
  return {
    queryId: String(options.queryId || 'worker-invocation-cpu-adhoc'),
    timeframe: {
      from: numeric(options.from),
      to: numeric(options.to)
    },
    dry: true,
    chart: false,
    compare: false,
    limit: boundedInteger(options.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    ...(options.offset ? { offset: String(options.offset), offsetDirection: 'next' } : {}),
    parameters: {
      datasets: ['cloudflare-workers'],
      filterCombination: 'and',
      filters,
      view: 'events'
    }
  };
}

function normalizeInvocation(event) {
  const workers = event?.$workers || {};
  const metadata = event?.$metadata || {};
  const cpuTimeMs = Number(workers.cpuTimeMs);
  if (!Number.isFinite(cpuTimeMs)) return null;
  return {
    id: trimmedText(metadata.id, 200),
    timestamp: Number(event?.timestamp || 0),
    datetime: event?.timestamp ? new Date(Number(event.timestamp)).toISOString() : null,
    requestId: trimmedText(workers.requestId, 200),
    eventType: trimmedText(workers.eventType || 'unknown', 40) || 'unknown',
    outcome: trimmedText(workers.outcome || metadata.outcome || 'unknown', 80) || 'unknown',
    cpuTimeMs,
    wallTimeMs: Number.isFinite(Number(workers.wallTimeMs)) ? Number(workers.wallTimeMs) : null,
    trigger: safeInvocationTrigger(metadata.trigger),
    transactionName: safeInvocationTrigger(metadata.transactionName),
    statusCode: Number.isFinite(Number(metadata.statusCode)) ? Number(metadata.statusCode) : null,
    coldStart: Boolean(Number(metadata.coldStart || 0)),
    scriptVersionId: trimmedText(workers.scriptVersion?.id, 200),
    scriptVersionTag: trimmedText(workers.scriptVersion?.tag, 200)
  };
}

function invocationKey(invocation) {
  return invocation.id || `${invocation.requestId}:${invocation.timestamp}:${invocation.cpuTimeMs}`;
}

function summarizeType(invocations, targetMs) {
  const cpuValues = invocations.map((item) => item.cpuTimeMs);
  const maximum = [...invocations].sort((left, right) => right.cpuTimeMs - left.cpuTimeMs)[0] || null;
  return {
    count: invocations.length,
    aboveTarget: invocations.filter((item) => item.cpuTimeMs > targetMs).length,
    p50Ms: percentile(cpuValues, 0.5),
    p95Ms: percentile(cpuValues, 0.95),
    p99Ms: percentile(cpuValues, 0.99),
    maxMs: maximum?.cpuTimeMs ?? null,
    maxInvocation: maximum
  };
}

export function summarizeInvocations(invocations, options = {}) {
  const targetMs = Math.max(0, numeric(options.targetMs || DEFAULT_TARGET_MS));
  const normalized = (Array.isArray(invocations) ? invocations : [])
    .filter((item) => Number.isFinite(Number(item?.cpuTimeMs)))
    .map((item) => ({ ...item, cpuTimeMs: Number(item.cpuTimeMs) }));
  const byEventType = {};
  for (const invocation of normalized) {
    const eventType = String(invocation.eventType || 'unknown');
    (byEventType[eventType] ||= []).push(invocation);
  }
  const eventTypes = Object.fromEntries(
    Object.entries(byEventType)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([eventType, rows]) => [eventType, summarizeType(rows, targetMs)])
  );
  const aboveTarget = normalized
    .filter((item) => item.cpuTimeMs > targetMs)
    .sort((left, right) => right.cpuTimeMs - left.cpuTimeMs);
  return {
    targetMs,
    returnedInvocations: normalized.length,
    aboveTargetCount: aboveTarget.length,
    all: summarizeType(normalized, targetMs),
    eventTypes,
    aboveTarget
  };
}

function formatMs(value) {
  return value == null ? 'n/a' : `${Number(value).toFixed(3)} ms`;
}

export function buildInvocationMarkdown(report) {
  const { summary } = report;
  if (report.available === false) {
    return `# Cloudflare Worker invocation CPU report

- Worker: \`${report.workerName}\`
- Window: ${report.datetimeStart} to ${report.datetimeEnd}
- Exact invocation telemetry: unavailable
- Reason: ${report.unavailableReason || 'unknown'}
- Required token permission: Workers Observability Write
- Aggregate GraphQL CPU reporting remains available.

No per-event-type or over-target invocation claim is made without returned telemetry events.
`;
  }
  const lines = [
    '# Cloudflare Worker invocation CPU report',
    '',
    `- Worker: \`${report.workerName}\``,
    `- Window: ${report.datetimeStart} to ${report.datetimeEnd}`,
    `- Matched events reported by Cloudflare: ${report.matchedEvents ?? 'unknown'}`,
    `- Returned invocations: ${summary.returnedInvocations}`,
    `- Result truncated by local cap: ${report.truncated}`,
    `- Cloudflare ABR sampling level: ${report.abrLevel ?? 'unknown'}`,
    `- Target: ${summary.targetMs.toFixed(3)} ms`,
    `- Returned invocations above target: ${summary.aboveTargetCount}`,
    `- Returned invocation P50: ${formatMs(summary.all.p50Ms)}`,
    `- Returned invocation P95: ${formatMs(summary.all.p95Ms)}`,
    `- Returned invocation P99: ${formatMs(summary.all.p99Ms)}`,
    `- Returned invocation maximum: ${formatMs(summary.all.maxMs)}`,
    '',
    '## Event types',
    '',
    '| Event type | Count | > target | P50 | P95 | P99 | Max |',
    '|---|---:|---:|---:|---:|---:|---:|'
  ];
  for (const [eventType, values] of Object.entries(summary.eventTypes)) {
    lines.push(`| ${eventType} | ${values.count} | ${values.aboveTarget} | ${formatMs(values.p50Ms)} | ${formatMs(values.p95Ms)} | ${formatMs(values.p99Ms)} | ${formatMs(values.maxMs)} |`);
  }
  if (!Object.keys(summary.eventTypes).length) lines.push('| no data | 0 | 0 | n/a | n/a | n/a | n/a |');
  lines.push('', '## Returned invocations above target', '');
  if (!summary.aboveTarget.length) {
    lines.push('None in the returned event set.');
  } else {
    lines.push('| CPU | Event type | Time | Outcome | Trigger | Request ID |', '|---:|---|---|---|---|---|');
    for (const item of summary.aboveTarget.slice(0, 100)) {
      lines.push(`| ${formatMs(item.cpuTimeMs)} | ${item.eventType} | ${item.datetime || 'unknown'} | ${item.outcome || 'unknown'} | ${item.trigger || item.transactionName || 'unknown'} | ${item.requestId || 'unknown'} |`);
    }
    if (summary.aboveTarget.length > 100) lines.push('', `${summary.aboveTarget.length - 100} additional over-target invocations are retained in JSON.`);
  }
  lines.push(
    '',
    'Percentiles above are calculated locally over the returned invocation events, not over unreturned or sampled events.',
    'A non-unit ABR level, a matched count larger than the returned count, or the local cap means the result is not complete coverage.'
  );
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

async function configuredWorkerName() {
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
  if (!response.ok || payload?.success === false || payload?.errors?.length) {
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

async function queryPage(token, accountId, options) {
  const payload = await cloudflare(
    `/accounts/${accountId}/workers/observability/telemetry/query`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(telemetryQueryBody(options))
    }
  );
  return payload?.result || {};
}

async function queryAccount(token, accountId, options) {
  const invocations = [];
  const seen = new Set();
  let offset = '';
  let matchedEvents = null;
  let abrLevel = null;
  let pages = 0;
  while (invocations.length < options.maxEvents) {
    const result = await queryPage(token, accountId, { ...options, offset });
    pages += 1;
    const events = result?.events?.events || [];
    if (matchedEvents == null && Number.isFinite(Number(result?.events?.count))) {
      matchedEvents = Number(result.events.count);
    }
    if (abrLevel == null && Number.isFinite(Number(result?.statistics?.abr_level))) {
      abrLevel = Number(result.statistics.abr_level);
    }
    let added = 0;
    for (const event of events) {
      const invocation = normalizeInvocation(event);
      if (!invocation) continue;
      const key = invocationKey(invocation);
      if (seen.has(key)) continue;
      seen.add(key);
      invocations.push(invocation);
      added += 1;
      if (invocations.length >= options.maxEvents) break;
    }
    if (!events.length || events.length < options.pageSize || added === 0) break;
    const nextOffset = String(events.at(-1)?.$metadata?.id || '');
    if (!nextOffset || nextOffset === offset) break;
    offset = nextOffset;
  }
  return {
    accountId,
    invocations,
    matchedEvents,
    abrLevel,
    pages,
    truncated: invocations.length >= options.maxEvents
      || (matchedEvents != null && matchedEvents > invocations.length)
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const allowUnavailable = String(args['allow-unavailable'] || '').toLowerCase() === 'true';
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '');
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not configured');
  const workerName = String(
    args.worker
    || process.env.CLOUDFLARE_WORKER_NAME
    || process.env.WORKER_NAME
    || await configuredWorkerName()
  );
  if (!workerName) throw new Error('Worker name is not configured');
  const hours = boundedInteger(args.hours, DEFAULT_HOURS, 1, MAX_HOURS);
  const targetMs = Math.max(0, numeric(args['target-ms'] || DEFAULT_TARGET_MS));
  const pageSize = boundedInteger(args['page-size'], DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const maxEvents = boundedInteger(args['max-events'], DEFAULT_MAX_EVENTS, 1, 100_000);
  const datetimeEnd = args.end ? new Date(args.end) : new Date();
  if (!Number.isFinite(datetimeEnd.getTime())) throw new Error('Invalid report end time');
  const datetimeStart = new Date(datetimeEnd.getTime() - hours * 60 * 60 * 1000);
  const options = {
    workerName,
    from: datetimeStart.getTime(),
    to: datetimeEnd.getTime(),
    pageSize,
    maxEvents,
    queryId: `worker-invocation-cpu-${Date.now()}`
  };
  const accountIds = await resolveAccountIds(token, String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim());
  let selected = null;
  const failures = [];
  for (const accountId of accountIds) {
    try {
      const result = await queryAccount(token, accountId, options);
      if (!selected || result.invocations.length > selected.invocations.length) selected = result;
      if (result.invocations.length) break;
    } catch (error) {
      failures.push({ accountId, error });
    }
  }
  if (!selected && failures.length) {
    const authorizationOnly = failures.every(({ error }) => isObservabilityAuthorizationError(error));
    if (allowUnavailable && authorizationOnly) {
      const report = {
        available: false,
        unavailableReason: 'configured token lacks Workers Observability Write permission',
        generatedAt: new Date().toISOString(),
        accountId: accountIds[0],
        workerName,
        datetimeStart: datetimeStart.toISOString(),
        datetimeEnd: datetimeEnd.toISOString(),
        matchedEvents: null,
        abrLevel: null,
        pages: 0,
        truncated: false,
        summary: summarizeInvocations([], { targetMs }),
        invocations: []
      };
      const markdown = buildInvocationMarkdown(report);
      await writeFile(args['out-json'] || 'worker-invocations-report.json', `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(args['out-markdown'] || 'worker-invocations-report.md', markdown);
      process.stdout.write(markdown);
      return;
    }
    throw new Error(failures
      .map(({ accountId, error }) => `${accountId}:${String(error?.message || error)}`)
      .join('; '));
  }
  const invocations = selected?.invocations || [];
  const report = {
    available: true,
    generatedAt: new Date().toISOString(),
    accountId: selected?.accountId || accountIds[0],
    workerName,
    datetimeStart: datetimeStart.toISOString(),
    datetimeEnd: datetimeEnd.toISOString(),
    matchedEvents: selected?.matchedEvents ?? null,
    abrLevel: selected?.abrLevel ?? null,
    pages: selected?.pages || 0,
    truncated: selected?.truncated || false,
    summary: summarizeInvocations(invocations, { targetMs }),
    invocations
  };
  const markdown = buildInvocationMarkdown(report);
  await writeFile(args['out-json'] || 'worker-invocations-report.json', `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(args['out-markdown'] || 'worker-invocations-report.md', markdown);
  process.stdout.write(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
