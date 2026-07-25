import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const FREE_READ_ROWS = 5_000_000;
const FREE_WRITE_ROWS = 100_000;
const TARGET_RATIO = 0.5;
const TARGET_READ_ROWS = FREE_READ_ROWS * TARGET_RATIO;
const TARGET_WRITE_ROWS = FREE_WRITE_ROWS * TARGET_RATIO;
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
if (!token || !accountId) {
  throw new Error('CLOUDFLARE_API_TOKEN and resolved CLOUDFLARE_ACCOUNT_ID are required');
}

const outputDir = path.resolve(process.env.D1_USAGE_OUTPUT_DIR || 'd1-usage');
await mkdir(outputDir, { recursive: true });

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftUtcDate(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function percentage(value, limit) {
  return limit > 0 ? (value / limit) * 100 : 0;
}

async function graphql(query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
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

async function referencedDatabases() {
  const workerDir = path.resolve('worker');
  const files = (await readdir(workerDir)).filter((name) => /^wrangler.*\.jsonc$/.test(name));
  const databases = new Map();
  const pattern = /"database_name"\s*:\s*"([^"]+)"[\s\S]{0,300}?"database_id"\s*:\s*"([^"]+)"/g;
  for (const file of files) {
    const text = await readFile(path.join(workerDir, file), 'utf8');
    for (const match of text.matchAll(pattern)) {
      const [, name, id] = match;
      const current = databases.get(id) || { id, name, configs: [] };
      current.configs.push(file);
      databases.set(id, current);
    }
  }
  if (!databases.size) throw new Error('No D1 databases found in worker/wrangler*.jsonc');
  return databases;
}

const query = `query D1DailyUsage($accountTag: string!, $start: Date!, $end: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $start, date_leq: $end }
        orderBy: [date_ASC]
      ) {
        sum {
          readQueries
          writeQueries
          rowsRead
          rowsWritten
          queryBatchResponseBytes
        }
        dimensions {
          date
          databaseId
        }
      }
    }
  }
}`;

const now = new Date();
const today = isoDate(now);
const yesterday = isoDate(shiftUtcDate(now, -1));
const start = isoDate(shiftUtcDate(now, -7));
const referenced = await referencedDatabases();
const groups = await graphql(query, { accountTag: accountId, start, end: today });
const databaseNames = new Map([...referenced.values()].map(({ id, name }) => [id, name]));

const daily = new Map();
const databaseDaily = new Map();
for (let cursor = new Date(`${start}T00:00:00Z`); isoDate(cursor) <= today; cursor = shiftUtcDate(cursor, 1)) {
  daily.set(isoDate(cursor), { date: isoDate(cursor), rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 });
}
for (const group of groups) {
  const date = String(group.dimensions?.date || '');
  const databaseId = String(group.dimensions?.databaseId || '');
  if (!referenced.has(databaseId)) continue;
  const sum = group.sum || {};
  const values = {
    rowsRead: numeric(sum.rowsRead),
    rowsWritten: numeric(sum.rowsWritten),
    readQueries: numeric(sum.readQueries),
    writeQueries: numeric(sum.writeQueries),
  };
  const total = daily.get(date) || { date, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 };
  for (const key of ['rowsRead', 'rowsWritten', 'readQueries', 'writeQueries']) total[key] += values[key];
  daily.set(date, total);
  const dbKey = `${date}:${databaseId}`;
  const db = databaseDaily.get(dbKey) || {
    date,
    databaseId,
    databaseName: databaseNames.get(databaseId) || databaseId,
    rowsRead: 0,
    rowsWritten: 0,
    readQueries: 0,
    writeQueries: 0,
  };
  for (const key of ['rowsRead', 'rowsWritten', 'readQueries', 'writeQueries']) db[key] += values[key];
  databaseDaily.set(dbKey, db);
}

const completeDays = [...daily.values()].filter((item) => item.date < today).sort((a, b) => a.date.localeCompare(b.date));
const lastSeven = completeDays.slice(-7);
const latestComplete = daily.get(yesterday) || { date: yesterday, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 };
const currentPartial = daily.get(today) || { date: today, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 };
const elapsedHours = Math.max(1, now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600);
const projectionFactor = Math.min(24, 24 / elapsedHours);
const projectedToday = {
  date: today,
  rowsRead: Math.round(currentPartial.rowsRead * projectionFactor),
  rowsWritten: Math.round(currentPartial.rowsWritten * projectionFactor),
  readQueries: Math.round(currentPartial.readQueries * projectionFactor),
  writeQueries: Math.round(currentPartial.writeQueries * projectionFactor),
};

function average(key) {
  return lastSeven.length ? Math.round(lastSeven.reduce((sum, day) => sum + day[key], 0) / lastSeven.length) : 0;
}
function maximum(key) {
  return lastSeven.length ? Math.max(...lastSeven.map((day) => day[key])) : 0;
}

const sevenDayAverage = {
  rowsRead: average('rowsRead'),
  rowsWritten: average('rowsWritten'),
  readQueries: average('readQueries'),
  writeQueries: average('writeQueries'),
};
const sevenDayMaximum = {
  rowsRead: maximum('rowsRead'),
  rowsWritten: maximum('rowsWritten'),
  readQueries: maximum('readQueries'),
  writeQueries: maximum('writeQueries'),
};
const planningEstimate = {
  rowsRead: Math.max(latestComplete.rowsRead, sevenDayAverage.rowsRead, projectedToday.rowsRead),
  rowsWritten: Math.max(latestComplete.rowsWritten, sevenDayAverage.rowsWritten, projectedToday.rowsWritten),
};
const latestDatabaseRows = [...databaseDaily.values()]
  .filter((item) => item.date === yesterday)
  .sort((a, b) => (b.rowsRead + b.rowsWritten) - (a.rowsRead + a.rowsWritten));

const report = {
  generatedAt: now.toISOString(),
  scope: 'repository-referenced-databases',
  window: { start, end: today, latestCompleteDate: yesterday },
  limits: {
    free: { rowsRead: FREE_READ_ROWS, rowsWritten: FREE_WRITE_ROWS },
    targetRatio: TARGET_RATIO,
    target: { rowsRead: TARGET_READ_ROWS, rowsWritten: TARGET_WRITE_ROWS },
  },
  accounts: [{ id: accountId, name: null }],
  databases: [...referenced.values()].map((database) => ({ ...database, accountId })),
  latestComplete,
  currentPartial,
  projectedToday,
  sevenDayAverage,
  sevenDayMaximum,
  planningEstimate,
  targetUtilization: {
    rowsReadPercent: percentage(planningEstimate.rowsRead, TARGET_READ_ROWS),
    rowsWrittenPercent: percentage(planningEstimate.rowsWritten, TARGET_WRITE_ROWS),
  },
  targetHeadroom: {
    rowsRead: TARGET_READ_ROWS - planningEstimate.rowsRead,
    rowsWritten: TARGET_WRITE_ROWS - planningEstimate.rowsWritten,
  },
  daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  latestCompleteByDatabase: latestDatabaseRows,
};

await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputDir, 'databases.json'), `${JSON.stringify(report.databases, null, 2)}\n`);

const fmt = new Intl.NumberFormat('en-US');
const lines = [
  '# D1 daily usage',
  '',
  `Generated: ${report.generatedAt}`,
  'Scope: D1 databases referenced by this repository',
  '',
  '| Metric | Free limit | 50% target | Latest complete day | 7-day average | 7-day maximum | Projected today | Planning estimate | Target utilization |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  `| Rows read | ${fmt.format(FREE_READ_ROWS)} | ${fmt.format(TARGET_READ_ROWS)} | ${fmt.format(latestComplete.rowsRead)} | ${fmt.format(sevenDayAverage.rowsRead)} | ${fmt.format(sevenDayMaximum.rowsRead)} | ${fmt.format(projectedToday.rowsRead)} | ${fmt.format(planningEstimate.rowsRead)} | ${percentage(planningEstimate.rowsRead, TARGET_READ_ROWS).toFixed(1)}% |`,
  `| Rows written | ${fmt.format(FREE_WRITE_ROWS)} | ${fmt.format(TARGET_WRITE_ROWS)} | ${fmt.format(latestComplete.rowsWritten)} | ${fmt.format(sevenDayAverage.rowsWritten)} | ${fmt.format(sevenDayMaximum.rowsWritten)} | ${fmt.format(projectedToday.rowsWritten)} | ${fmt.format(planningEstimate.rowsWritten)} | ${percentage(planningEstimate.rowsWritten, TARGET_WRITE_ROWS).toFixed(1)}% |`,
  '',
  `Planning headroom: ${fmt.format(report.targetHeadroom.rowsRead)} read rows/day and ${fmt.format(report.targetHeadroom.rowsWritten)} written rows/day.`,
  '',
  `## ${yesterday} by database`,
  '',
  '| Database | Rows read | Rows written | Read queries | Write queries |',
  '|---|---:|---:|---:|---:|',
  ...latestDatabaseRows.map((item) => `| ${item.databaseName} | ${fmt.format(item.rowsRead)} | ${fmt.format(item.rowsWritten)} | ${fmt.format(item.readQueries)} | ${fmt.format(item.writeQueries)} |`),
  '',
];
await writeFile(path.join(outputDir, 'summary.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({
  latestComplete,
  sevenDayAverage,
  sevenDayMaximum,
  projectedToday,
  planningEstimate,
  targetUtilization: report.targetUtilization,
  targetHeadroom: report.targetHeadroom,
}));
