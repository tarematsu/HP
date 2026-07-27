import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const DEFAULT_WRITE_LIMIT = 4_000;
const DEFAULT_WRITE_WINDOW_MINUTES = 60;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function configuredWriteLimit(value) {
  return positiveInteger(value, DEFAULT_WRITE_LIMIT, 1, 1_000_000);
}

function configuredReadLimit(value) {
  if (value == null || String(value).trim() === '' || Number(value) <= 0) return null;
  return positiveInteger(value, 1, 1, 1_000_000_000);
}

export function guardDecision(rowsWritten, limit = DEFAULT_WRITE_LIMIT) {
  const observed = Math.max(0, Number(rowsWritten) || 0);
  const limitValue = configuredWriteLimit(limit);
  return {
    allowed: observed < limitValue,
    rowsWritten: observed,
    limit: limitValue,
    headroom: Math.max(0, limitValue - observed),
  };
}

export function combinedGuardDecision(
  rowsWritten,
  rowsRead,
  writeLimit = DEFAULT_WRITE_LIMIT,
  readLimit = null,
) {
  const write = guardDecision(rowsWritten, writeLimit);
  const normalizedReadLimit = configuredReadLimit(readLimit);
  if (normalizedReadLimit == null) return write;
  const observedRead = Math.max(0, Number(rowsRead) || 0);
  const readAllowed = observedRead < normalizedReadLimit;
  return {
    ...write,
    allowed: write.allowed && readAllowed,
    writeAllowed: write.allowed,
    readAllowed,
    rowsRead: observedRead,
    readLimit: normalizedReadLimit,
    readHeadroom: Math.max(0, normalizedReadLimit - observedRead),
  };
}

export function unavailableGuardDecision(error, limit = DEFAULT_WRITE_LIMIT, readLimit = null) {
  const result = {
    allowed: false,
    rowsWritten: null,
    limit: configuredWriteLimit(limit),
    headroom: 0,
    reason: 'telemetry-unavailable',
    error: String(error?.message || error || 'D1 telemetry unavailable').slice(0, 800),
  };
  const normalizedReadLimit = configuredReadLimit(readLimit);
  if (normalizedReadLimit != null) {
    Object.assign(result, {
      writeAllowed: false,
      readAllowed: false,
      rowsRead: null,
      readLimit: normalizedReadLimit,
      readHeadroom: 0,
    });
  }
  return result;
}

async function referencedDatabaseIds() {
  const workerDir = path.join(repositoryRoot, 'worker');
  const files = (await readdir(workerDir)).filter((name) => /^wrangler.*\.jsonc$/.test(name));
  const ids = new Set();
  const pattern = /"database_id"\s*:\s*"([^"]+)"/g;
  for (const file of files) {
    const source = await readFile(path.join(workerDir, file), 'utf8');
    for (const match of source.matchAll(pattern)) ids.add(match[1]);
  }
  if (!ids.size) throw new Error('No D1 database IDs found in worker/wrangler*.jsonc');
  return ids;
}

async function queryD1Usage({ token, accountId, start, end }) {
  const query = `query D1ActionsGuard($accountTag: string!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { datetime_geq: $start, datetime_leq: $end }
          orderBy: [datetimeFifteenMinutes_ASC]
        ) {
          sum { rowsRead rowsWritten }
          dimensions { databaseId }
        }
      }
    }
  }`;
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { accountTag: accountId, start, end } }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok || body?.errors?.length) {
    throw new Error(`Cloudflare GraphQL failed (${response.status}): ${JSON.stringify(body?.errors || body).slice(0, 1200)}`);
  }
  const accounts = body?.data?.viewer?.accounts || [];
  if (accounts.length !== 1) throw new Error(`Expected one GraphQL account row, got ${accounts.length}`);
  return accounts[0].d1AnalyticsAdaptiveGroups || [];
}

function sumMetric(groups, databaseIds, metric) {
  let total = 0;
  for (const group of groups) {
    if (!databaseIds.has(String(group.dimensions?.databaseId || ''))) continue;
    total += Math.max(0, Number(group.sum?.[metric]) || 0);
  }
  return total;
}

function utcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

export async function runD1WriteGuard(options = {}) {
  const token = String(options.token ?? process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
  const accountId = String(options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  if (!token || !accountId) {
    throw new Error('CLOUDFLARE_API_TOKEN and resolved CLOUDFLARE_ACCOUNT_ID are required');
  }
  const writeLimit = configuredWriteLimit(
    options.limit ?? process.env.D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT,
  );
  const readLimit = configuredReadLimit(
    options.readLimit ?? process.env.D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT,
  );
  const writeWindowMinutes = positiveInteger(
    options.windowMinutes ?? process.env.D1_ACTIONS_WRITE_WINDOW_MINUTES,
    DEFAULT_WRITE_WINDOW_MINUTES,
    1,
    DEFAULT_WRITE_WINDOW_MINUTES,
  );
  const now = new Date(options.now ?? Date.now());
  const writeStart = new Date(now.getTime() - writeWindowMinutes * 60_000).toISOString();
  const end = now.toISOString();
  const databaseIds = options.databaseIds || await referencedDatabaseIds();
  const writeGroups = options.writeGroups || options.groups
    || await queryD1Usage({ token, accountId, start: writeStart, end });
  const rowsWritten = sumMetric(writeGroups, databaseIds, 'rowsWritten');

  let rowsRead = null;
  let readStart = null;
  if (readLimit != null) {
    readStart = utcDayStart(now);
    const readGroups = options.readGroups
      || (readStart === writeStart
        ? writeGroups
        : await queryD1Usage({ token, accountId, start: readStart, end }));
    rowsRead = sumMetric(readGroups, databaseIds, 'rowsRead');
  }

  return {
    ...combinedGuardDecision(rowsWritten, rowsRead, writeLimit, readLimit),
    window: { start: writeStart, end, minutes: writeWindowMinutes },
    ...(readLimit == null ? {} : { readWindow: { start: readStart, end, scope: 'utc-day' } }),
    databaseCount: databaseIds.size,
  };
}

function guardReason(result) {
  if (result.allowed) return 'within-budget';
  if (result.readLimit == null) return 'budget-exceeded';
  if (!result.readAllowed && !result.writeAllowed) return 'read-and-write-budget-exceeded';
  if (!result.readAllowed) return 'read-budget-exceeded';
  return 'write-budget-exceeded';
}

export async function runD1WriteGuardCli(options = {}) {
  const readLimit = options.readLimit ?? process.env.D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT;
  try {
    const result = await (options.run || runD1WriteGuard)(options);
    return {
      ...result,
      reason: guardReason(result),
    };
  } catch (error) {
    return unavailableGuardDecision(
      error,
      options.limit ?? process.env.D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT,
      readLimit,
    );
  }
}

async function writeGithubOutput(result, output) {
  if (!output) return;
  const { appendFile } = await import('node:fs/promises');
  const rowsWritten = result.rowsWritten == null ? 'unknown' : result.rowsWritten;
  const lines = [
    `allowed=${result.allowed}`,
    `rows_written=${rowsWritten}`,
    `limit=${result.limit}`,
    `reason=${result.reason}`,
  ];
  if (result.readLimit != null) {
    lines.push(
      `rows_read=${result.rowsRead == null ? 'unknown' : result.rowsRead}`,
      `read_limit=${result.readLimit}`,
      `read_allowed=${result.readAllowed}`,
      `write_allowed=${result.writeAllowed}`,
    );
  }
  lines.push('');
  await appendFile(output, lines.join('\n'));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runD1WriteGuardCli();
  await writeGithubOutput(result, process.env.GITHUB_OUTPUT);
  const event = { event: 'd1_actions_usage_guard', ...result };
  if (result.reason === 'telemetry-unavailable') console.warn(JSON.stringify(event));
  else console.log(JSON.stringify(event));
}
