import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseCadenceSeconds,
} from '../../site/functions/lib/api-contract.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';
const HISTORY_REFRESH_PHASE_MINUTES = 4;

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

export function dueVariantKeys(now) {
  const minute = Math.floor(Number(now) / 60_000);
  const due = new Set(['dashboard']);
  for (const variant of MATERIALIZED_API_VARIANTS) {
    if (variant.key === 'dashboard') continue;
    const cadence = Math.trunc(Number(variant.cadence_minutes));
    if (!Number.isFinite(cadence) || cadence <= 0) continue;
    if (minute % cadence === Math.min(HISTORY_REFRESH_PHASE_MINUTES, cadence - 1)) {
      due.add(variant.key);
    }
  }
  return due;
}

async function responseHandler(modelKey) {
  if (modelKey === 'dashboard') return (await import('../../site/functions/api/dashboard.js')).onRequestGet;
  if (modelKey.startsWith('history:')) return (await import('../../site/functions/lib/materialized-history.js')).onRequestGet;
  if (modelKey === 'host-history:summary') return (await import('../../site/functions/api/host-history.js')).onRequestGet;
  throw new Error(`unsupported Actions read model: ${modelKey}`);
}

function persistedHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    const normalized = key.toLowerCase();
    if (normalized === 'cache-control'
        || normalized === 'content-length'
        || normalized === 'transfer-encoding') continue;
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
  if (!response.ok) {
    throw new Error(`${variant.key} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
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

function remoteDatabase(database, suffix) {
  return createWranglerRemoteD1({
    database,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: `.pages-read-model-${suffix}-`,
  });
}

function productionEnvironment() {
  const buddiesDb = remoteDatabase(buddiesDatabase, 'buddies');
  return {
    DB: buddiesDb,
    BUDDIES_DB: buddiesDb,
    MINUTE_DB: remoteDatabase(factsDatabase, 'minute'),
    OTHER_DB: remoteDatabase(otherDatabase, 'other'),
  };
}

export async function runPagesReadModelActions(options = {}) {
  const clock = options.now || Date.now;
  const startedAt = Number(options.startedAt ?? clock());
  if (!Number.isFinite(startedAt)) throw new Error('Pages read-model start time is invalid');
  const configuredDeadline = Number(options.deadlineMs);
  const deadlineMs = Number.isFinite(configuredDeadline)
    ? configuredDeadline
    : startedAt + positiveInteger(
      process.env.PAGES_READ_MODEL_DEADLINE_MS,
      12 * 60_000,
      60_000,
      14 * 60_000,
    );
  const env = options.env || productionEnvironment();
  const renderVariant = options.materializeVariant || materializeVariant;
  const variants = options.variants || MATERIALIZED_API_VARIANTS;
  const dueKeys = new Set(options.dueKeys || dueVariantKeys(startedAt));
  const published = [];

  for (const variant of variants.filter((item) => dueKeys.has(item.key))) {
    if (Number(clock()) >= deadlineMs) {
      throw new Error('Pages variant materialization exceeded the Actions deadline');
    }
    published.push(await renderVariant(variant, env, startedAt));
  }

  return {
    ok: true,
    event: 'pages_read_model_actions_complete',
    track_history_steps: 0,
    track_history_deferred: false,
    track_history_defer_reason: null,
    track_history_result: {
      skipped: true,
      reason: 'track-history-read-model-disabled',
    },
    elapsed_ms: Math.max(0, Number(clock()) - startedAt),
    published,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runPagesReadModelActions()));
}
