import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const DEFAULT_LIMIT = 4_000;
const DEFAULT_WINDOW_MINUTES = 60;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function guardDecision(rowsWritten, limit = DEFAULT_LIMIT) {
  const observed = Math.max(0, Number(rowsWritten) || 0);
  const configuredLimit = positiveInteger(limit, DEFAULT_LIMIT, 1, 1_000_000);
  return {
    allowed: observed < configuredLimit,
    rowsWritten: observed,
    limit: configuredLimit,
    headroom: Math.max(0, configuredLimit - observed),
  };
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

async function queryRowsWritten({ token, accountId, start, end }) {
  const query = `query D1WriteGuard($accountTag: string!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { datetime_geq: $start, datetime_leq: $end }
          orderBy: [datetimeFifteenMinutes_ASC]
        ) {
          sum { rowsWritten }
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

export async function runD1WriteGuard(options = {}) {
  const token = String(options.token ?? process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
  const accountId = String(options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  if (!token || !accountId) {
    throw new Error('CLOUDFLARE_API_TOKEN and resolved CLOUDFLARE_ACCOUNT_ID are required');
  }
  const limit = positiveInteger(
    options.limit ?? process.env.D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT,
    DEFAULT_LIMIT,
    1,
    1_000_000,
  );
  const windowMinutes = positiveInteger(
    options.windowMinutes ?? process.env.D1_ACTIONS_WRITE_WINDOW_MINUTES,
    DEFAULT_WINDOW_MINUTES,
    1,
    DEFAULT_WINDOW_MINUTES,
  );
  const now = new Date(options.now ?? Date.now());
  const start = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const end = now.toISOString();
  const databaseIds = options.databaseIds || await referencedDatabaseIds();
  const groups = options.groups || await queryRowsWritten({ token, accountId, start, end });
  let rowsWritten = 0;
  for (const group of groups) {
    if (!databaseIds.has(String(group.dimensions?.databaseId || ''))) continue;
    rowsWritten += Math.max(0, Number(group.sum?.rowsWritten) || 0);
  }
  return {
    ...guardDecision(rowsWritten, limit),
    window: { start, end, minutes: windowMinutes },
    databaseCount: databaseIds.size,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runD1WriteGuard();
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(output, `allowed=${result.allowed}\nrows_written=${result.rowsWritten}\nlimit=${result.limit}\n`);
  }
  console.log(JSON.stringify({ event: 'd1_actions_write_guard', ...result }));
}
