import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseCadenceSeconds,
} from '../../site/functions/lib/api-contract.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { runSplitTrackHistoryCycleStep } from '../src/pages-track-history-split-cycle.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';
const maxSteps = Math.max(1, Math.min(3000, Math.trunc(Number(process.env.PAGES_READ_MODEL_MAX_STEPS || 1800))));
const startedAt = Date.now();
const deadlineMs = startedAt + Math.max(60_000, Math.trunc(Number(process.env.PAGES_READ_MODEL_DEADLINE_MS || 12 * 60_000)));

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function parseRows(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) return [];
  const payload = JSON.parse(text.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  for (const container of containers) {
    const rows = container?.results || container?.result?.results || container?.result?.[0]?.results;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll('\u0000', '').replaceAll("'", "''")}'`;
}

function bindSql(sql, bindings) {
  let index = 0;
  const rendered = String(sql).replace(/\?/g, () => {
    if (index >= bindings.length) throw new Error('D1 adapter binding count mismatch');
    return sqlValue(bindings[index++]);
  });
  if (index !== bindings.length) throw new Error('D1 adapter received unused bindings');
  return rendered;
}

function execute(database, sql, json = true) {
  const args = ['d1', 'execute', database, '--remote', '--yes'];
  if (json) args.push('--json');
  args.push('--command', sql);
  return wrangler(args);
}

function createStatement(database, sql, bindings = []) {
  const rendered = () => bindSql(sql, bindings);
  const statement = {
    __sql: String(sql),
    __bindings: bindings,
    bind(...values) { return createStatement(database, sql, values); },
    async all() { return { results: parseRows(execute(database, rendered(), true)) }; },
    async first() { return parseRows(execute(database, rendered(), true))[0] || null; },
    async run() {
      const rows = parseRows(execute(database, rendered(), true));
      return { success: true, meta: rows[0]?.meta || {}, results: rows };
    },
  };
  return statement;
}

function createRemoteD1(database) {
  return {
    prepare(sql) { return createStatement(database, sql); },
    async batch(statements) {
      const directory = mkdtempSync(join(workerRoot, '.pages-read-model-actions-'));
      try {
        const path = join(directory, 'batch.sql');
        const sql = statements.map((statement) => `${bindSql(statement.__sql, statement.__bindings || [])};`).join('\n');
        writeFileSync(path, `${sql}\n`, 'utf8');
        wrangler(['d1', 'execute', database, '--remote', '--yes', '--file', path], { capture: false });
        return statements.map(() => ({ success: true, meta: {} }));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

function dueVariantKeys(now) {
  const minute = Math.floor(now / 60_000);
  const due = new Set(['dashboard']);
  if (minute % 60 === 4) due.add('history:daily');
  if (minute % 180 === 4) {
    due.add('history:weekly');
    due.add('history:broadcasts');
  }
  if (minute % 360 === 4) due.add('history:monthly');
  if (minute % 1440 === 4) due.add('host-history:summary');
  return due;
}

async function responseHandler(modelKey) {
  if (modelKey === 'dashboard') return (await import('../../site/functions/api/dashboard.js')).onRequestGet;
  if (modelKey.startsWith('history:')) return (await import('../../site/functions/api/history.js')).onRequestGet;
  if (modelKey === 'host-history:summary') return (await import('../../site/functions/api/host-history.js')).onRequestGet;
  throw new Error(`unsupported Actions read model: ${modelKey}`);
}

function persistedHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    const normalized = key.toLowerCase();
    if (normalized === 'cache-control' || normalized === 'content-length' || normalized === 'transfer-encoding') continue;
    headers[key] = value;
  }
  if (!headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';
  return headers;
}

function uploadEnvelope(modelKey, envelope) {
  const directory = mkdtempSync(join(workerRoot, '.pages-response-actions-'));
  try {
    const path = join(directory, `${encodeURIComponent(modelKey)}.json`);
    writeFileSync(path, JSON.stringify(envelope), 'utf8');
    const key = pagesActionsR2ResponseKey(modelKey);
    wrangler([
      'r2', 'object', 'put', `${responseBucket}/${key}`,
      '--remote', '--file', path,
      '--content-type', 'application/json; charset=utf-8',
    ], { capture: false });
    return key;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function materializeVariant(variant, env, now) {
  const handler = await responseHandler(variant.key);
  const response = await handler({
    request: new Request(`https://pages-materializer.invalid${variant.url}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    env,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${variant.key} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  JSON.parse(body);
  const envelope = {
    version: 1,
    status: response.status,
    headers: persistedHeaders(response),
    updated_at: now,
    cadence_seconds: materializedResponseCadenceSeconds(variant.key),
    body,
  };
  return {
    key: variant.key,
    bytes: body.length,
    object_key: uploadEnvelope(variant.key, envelope),
  };
}

const minuteDb = createRemoteD1(factsDatabase);
const buddiesDb = createRemoteD1(buddiesDatabase);
const otherDb = createRemoteD1(otherDatabase);
const env = {
  DB: buddiesDb,
  BUDDIES_DB: buddiesDb,
  MINUTE_DB: minuteDb,
  OTHER_DB: otherDb,
  PAGES_TRACK_HISTORY_CYCLE_ENABLED: true,
};

let steps = 0;
let lastResult = null;
let timestamp = Math.floor(startedAt / 86_400_000) * 86_400_000;
while (steps < maxSteps && Date.now() < deadlineMs) {
  lastResult = await runSplitTrackHistoryCycleStep({ ...env, BUDDIES_DB: minuteDb }, timestamp, {});
  steps += 1;
  timestamp += 60_000;
  if (lastResult?.reason === 'track-history-cycle-already-published') break;
  if (lastResult?.stage?.published === true || lastResult?.publication?.phase === 'complete') break;
}
if (!lastResult) throw new Error('Pages track-history runner produced no result');
if (steps >= maxSteps && lastResult?.stage?.published !== true) {
  throw new Error(`Pages track-history rebuild did not finish within ${steps} steps`);
}

const dueKeys = dueVariantKeys(startedAt);
const variants = MATERIALIZED_API_VARIANTS.filter((variant) => dueKeys.has(variant.key));
const published = [];
for (const variant of variants) {
  if (Date.now() >= deadlineMs) throw new Error('Pages variant materialization exceeded the Actions deadline');
  published.push(await materializeVariant(variant, env, startedAt));
}

console.log(JSON.stringify({
  ok: true,
  event: 'pages_read_model_actions_complete',
  track_history_steps: steps,
  elapsed_ms: Date.now() - startedAt,
  published,
  track_history_result: lastResult,
}));
