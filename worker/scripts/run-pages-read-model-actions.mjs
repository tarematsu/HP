import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseCadenceSeconds,
  materializedResponseMaximumAge,
} from '../../site/functions/lib/api-contract.js';
import { SUMMARY_TABLES } from '../../site/functions/lib/history-summary.js';
import { currentPeriodKey } from '../../site/functions/lib/period-completeness.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';
const WORKFLOW_INTERVAL_MINUTES = 30;
const HISTORY_REFRESH_PHASE_MINUTES = 26;
const DASHBOARD_MIN_REFRESH_MS = 5 * 60_000;
const COMMON_RENDERER_PATHS = Object.freeze([
  'worker/scripts/run-pages-read-model-actions.mjs',
]);
const SUMMARY_RENDERER_PATHS = Object.freeze([
  'site/functions/lib/materialized-history.js',
  'site/functions/lib/history-summary.js',
  'site/functions/lib/period-completeness.js',
  'site/functions/lib/api-utils.js',
]);
const RENDERER_PATHS = Object.freeze({
  'history:daily': SUMMARY_RENDERER_PATHS,
  'history:weekly': SUMMARY_RENDERER_PATHS,
  'history:monthly': SUMMARY_RENDERER_PATHS,
  'history:broadcasts': Object.freeze([
    'site/functions/lib/materialized-history.js',
    'site/functions/api/history.js',
    'site/functions/lib/api-utils.js',
  ]),
  'host-history:summary': Object.freeze([
    'site/functions/api/host-history.js',
  ]),
  'spotify-playcounts': Object.freeze([
    'site/functions/api/spotify-playcounts.js',
  ]),
});

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function enabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

function scheduledSlotMinute(now) {
  const minute = Math.floor(Number(now) / 60_000);
  return minute - positiveModulo(
    minute - HISTORY_REFRESH_PHASE_MINUTES,
    WORKFLOW_INTERVAL_MINUTES,
  );
}

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

export function dueVariantKeys(now, options = {}) {
  const due = new Set(['dashboard']);
  if (options.forceAll === true) {
    return new Set(MATERIALIZED_API_VARIANTS.map(({ key }) => key));
  }

  // GitHub scheduled workflows can start several minutes after their nominal cron
  // time. Resolve the current execution to the most recent :26/:56 slot so a
  // delayed :26 run still publishes the six-hour and daily models.
  const slotMinute = scheduledSlotMinute(now);
  for (const variant of MATERIALIZED_API_VARIANTS) {
    if (variant.key === 'dashboard') continue;
    const cadence = Math.trunc(Number(variant.cadence_minutes));
    if (!Number.isFinite(cadence) || cadence <= 0) continue;
    if (positiveModulo(slotMinute - HISTORY_REFRESH_PHASE_MINUTES, cadence) === 0) {
      due.add(variant.key);
    }
  }
  return due;
}

async function responseHandler(modelKey) {
  if (modelKey === 'dashboard') return (await import('../../site/functions/api/dashboard.js')).onRequestGet;
  if (modelKey.startsWith('history:')) return (await import('../../site/functions/lib/materialized-history.js')).onRequestGet;
  if (modelKey === 'host-history:summary') return (await import('../../site/functions/api/host-history.js')).onRequestGet;
  if (modelKey === 'spotify-playcounts') return (await import('../../site/functions/api/spotify-playcounts.js')).onRequestGet;
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

export function uploadEnvelope(modelKey, envelope) {
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

function loadR2JsonObject(key, strict = false) {
  const directory = mkdtempSync(join(workerRoot, '.pages-response-existing-'));
  try {
    const path = join(directory, 'object.json');
    try {
      wrangler(['r2', 'object', 'get', `${responseBucket}/${key}`, '--remote', '--file', path]);
    } catch (error) {
      if (strict && !/404|not found|does not exist/i.test(String(error.stderr || error.message))) throw error;
      return null;
    }
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function loadExistingEnvelope(modelKey) {
  return loadR2JsonObject(pagesActionsR2ResponseKey(modelKey));
}

export async function overdueVariantKeys(variants, now, dependencies = {}) {
  const loadExisting = dependencies.loadExistingEnvelope || loadExistingEnvelope;
  const overdue = new Set();
  for (const variant of variants) {
    if (variant.key === 'dashboard') continue;
    const existing = await loadExisting(variant.key);
    const updatedAt = Number(existing?.updated_at);
    const maxAge = materializedResponseMaximumAge(variant.key);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0 || Number(now) - updatedAt >= maxAge) {
      overdue.add(variant.key);
    }
  }
  return overdue;
}

function revisionValue(prefix, row, fields) {
  return [prefix, ...fields.map((field) => `${field}=${String(row?.[field] ?? 0)}`)].join(':');
}

function rendererRevisionFor(modelKey) {
  const paths = [...new Set([
    ...COMMON_RENDERER_PATHS,
    ...(RENDERER_PATHS[modelKey] || []),
  ])].sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(resolve(repositoryRoot, path)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function loadVariantSourceRevision(variant, env, now = Date.now()) {
  const modelKey = String(variant?.key || '');
  if (modelKey === 'dashboard') return null;

  if (modelKey.startsWith('history:')) {
    const mode = modelKey.slice('history:'.length);
    const table = SUMMARY_TABLES[mode];
    if (table) {
      const currentFilter = mode === 'daily' ? ' WHERE period_key<?' : '';
      const statement = env.OTHER_DB.prepare(
        `SELECT COUNT(*) AS row_count,
          COALESCE(MAX(updated_at),0) AS max_updated_at,
          COALESCE(SUM(updated_at),0) AS sum_updated_at
         FROM ${table}${currentFilter}`,
      );
      const row = mode === 'daily'
        ? await statement.bind(currentPeriodKey('daily', now)).first()
        : await statement.first();
      return revisionValue(
        `summary:${mode}`,
        row,
        ['row_count', 'max_updated_at', 'sum_updated_at'],
      );
    }
    if (mode === 'broadcasts') {
      const row = await env.OTHER_DB.prepare(`SELECT COUNT(*) AS row_count,
          COALESCE(MAX(refreshed_at),0) AS max_refreshed_at,
          COALESCE(SUM(refreshed_at),0) AS sum_refreshed_at,
          COALESCE(MAX(ended_at),0) AS max_ended_at
        FROM sh_official_broadcast_summary
        WHERE host_handle='sakurazaka46jp'`).first();
      return revisionValue(
        'broadcasts',
        row,
        ['row_count', 'max_refreshed_at', 'sum_refreshed_at', 'max_ended_at'],
      );
    }
  }

  if (modelKey === 'host-history:summary') {
    const row = await env.OTHER_DB.prepare(`SELECT COUNT(*) AS row_count,
        COALESCE(MAX(last_observed_at),0) AS max_observed_at,
        COALESCE(MAX(ended_at),0) AS max_ended_at,
        COALESCE(SUM(COALESCE(last_observed_at,0)+COALESCE(ended_at,0)),0) AS sum_revision
      FROM sh_host_broadcast_sessions
      WHERE handle='sakurazaka46jp'`).first();
    return revisionValue(
      'host-summary',
      row,
      ['row_count', 'max_observed_at', 'max_ended_at', 'sum_revision'],
    );
  }

  if (modelKey === 'spotify-playcounts') {
    const row = await env.OTHER_DB.prepare(`WITH latest_complete AS (
        SELECT snapshot_date,run_token,tracks_collected,completed_at,updated_at
        FROM sh_spotify_collection_runs
        WHERE status='complete'
        ORDER BY snapshot_date DESC
        LIMIT 1
      ), latest_ranking_date AS (
        SELECT ranking_date
        FROM sh_spotify_top20_history
        ORDER BY ranking_date DESC
        LIMIT 1
      ), latest_ranking_signature AS (
        SELECT GROUP_CONCAT(artist_key || ':' || rank, '|') AS ranking_signature
        FROM (
          SELECT history.artist_key,history.rank
          FROM sh_spotify_top20_history history
          WHERE history.ranking_date=(SELECT ranking_date FROM latest_ranking_date)
          ORDER BY history.artist_key
        )
      ), artist_signature AS (
        SELECT GROUP_CONCAT(artist_key || ':' || artist_name, '|') AS artist_signature
        FROM (
          SELECT artist_key,artist_name
          FROM sh_spotify_artists
          ORDER BY artist_key
        )
      )
      SELECT
        COALESCE((SELECT snapshot_date FROM latest_complete),'') AS max_snapshot_date,
        COALESCE((SELECT run_token FROM latest_complete),'') AS run_token,
        COALESCE((SELECT tracks_collected FROM latest_complete),0) AS tracks_collected,
        COALESCE((SELECT completed_at FROM latest_complete),0) AS completed_at,
        COALESCE((SELECT updated_at FROM latest_complete),0) AS run_updated_at,
        COALESCE((SELECT ranking_date FROM latest_ranking_date),'') AS ranking_date,
        COALESCE((SELECT ranking_signature FROM latest_ranking_signature),'') AS ranking_signature,
        COALESCE((SELECT artist_signature FROM artist_signature),'') AS artist_signature`).first();
    return revisionValue(
      'spotify-playcounts',
      row,
      [
        'max_snapshot_date',
        'run_token',
        'tracks_collected',
        'completed_at',
        'run_updated_at',
        'ranking_date',
        'ranking_signature',
        'artist_signature',
      ],
    );
  }
  return null;
}

function reusableEnvelope(envelope, sourceRevision, rendererRevision) {
  return Number(envelope?.version) === 1
    && typeof envelope?.body === 'string'
    && envelope.source_revision === sourceRevision
    && envelope.renderer_revision === rendererRevision;
}

export async function materializeVariant(variant, env, now, dependencies = {}) {
  const loadExisting = dependencies.loadExistingEnvelope || loadExistingEnvelope;
  const loadRevision = dependencies.loadSourceRevision || loadVariantSourceRevision;
  const resolveHandler = dependencies.responseHandler || responseHandler;
  const upload = dependencies.uploadEnvelope || uploadEnvelope;
  const rendererRevision = String(
    dependencies.rendererRevision ?? rendererRevisionFor(variant.key),
  );
  const existing = await loadExisting(variant.key);
  const sourceRevision = await loadRevision(variant, env, now);
  const cadenceSeconds = materializedResponseCadenceSeconds(variant.key);

  const existingUpdatedAt = Number(existing?.updated_at);
  if (variant.key === 'dashboard'
      && Number(existing?.version) === 1
      && typeof existing?.body === 'string'
      && existing.renderer_revision === rendererRevision
      && Number.isFinite(existingUpdatedAt)
      && existingUpdatedAt > 0
      && Number(now) - existingUpdatedAt < DASHBOARD_MIN_REFRESH_MS) {
    return {
      key: variant.key,
      bytes: existing.body.length,
      object_key: null,
      source_revision: sourceRevision,
      renderer_revision: rendererRevision,
      rendered: false,
      changed: false,
      deferred: false,
      skipped: true,
      skip_reason: 'minimum-refresh-interval',
    };
  }

  if (sourceRevision && reusableEnvelope(existing, sourceRevision, rendererRevision)) {
    if (dependencies.skipUnchanged === true) return {
      key: variant.key, bytes: existing.body.length, object_key: null,
      source_revision: sourceRevision, renderer_revision: rendererRevision,
      rendered: false, changed: false, deferred: false, skipped: true,
      skip_reason: 'unchanged-source',
    };
    const envelope = {
      ...existing,
      updated_at: now,
      cadence_seconds: cadenceSeconds,
    };
    return {
      key: variant.key,
      bytes: existing.body.length,
      object_key: upload(variant.key, envelope),
      source_revision: sourceRevision,
      renderer_revision: rendererRevision,
      rendered: false,
      changed: false,
      deferred: false,
    };
  }

  if (dependencies.reuseOnly === true) {
    const sourceChanged = Boolean(existing && sourceRevision !== existing.source_revision);
    const rendererChanged = Boolean(existing && rendererRevision !== existing.renderer_revision);
    return {
      key: variant.key,
      bytes: typeof existing?.body === 'string' ? existing.body.length : 0,
      object_key: null,
      source_revision: sourceRevision,
      renderer_revision: rendererRevision,
      rendered: false,
      changed: !existing || sourceChanged || rendererChanged,
      deferred: true,
      defer_reason: !existing
        ? 'missing-existing-envelope'
        : sourceChanged
          ? 'source-revision-changed'
          : rendererChanged
            ? 'renderer-revision-changed'
            : 'existing-envelope-not-reusable',
    };
  }

  const handler = await resolveHandler(variant.key);
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
  const headers = persistedHeaders(response);
  const envelope = {
    version: 1,
    status: response.status,
    headers,
    updated_at: now,
    cadence_seconds: cadenceSeconds,
    source_revision: sourceRevision,
    renderer_revision: rendererRevision,
    body,
  };
  const changed = !existing
    || existing.body !== body
    || Number(existing.status) !== response.status
    || JSON.stringify(existing.headers || {}) !== JSON.stringify(headers);
  return {
    key: variant.key,
    bytes: body.length,
    object_key: upload(variant.key, envelope),
    source_revision: sourceRevision,
    renderer_revision: rendererRevision,
    rendered: true,
    changed,
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
    PAGES_RESPONSE_R2: {
      async get(key) {
        const value = loadR2JsonObject(key, true);
        return value ? { json: async () => value } : null;
      },
    },
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
  const forceAll = options.forceAll ?? enabled(process.env.PAGES_READ_MODEL_FORCE_ALL);
  const dueKeys = new Set(options.dueKeys || dueVariantKeys(startedAt, { forceAll }));
  const retryOverdue = options.retryOverdue
    ?? enabled(process.env.PAGES_READ_MODEL_RETRY_OVERDUE);
  if (!forceAll && retryOverdue && options.dueKeys == null) {
    const overdueKeys = await overdueVariantKeys(variants, startedAt, {
      loadExistingEnvelope: options.loadExistingEnvelope,
    });
    for (const key of overdueKeys) dueKeys.add(key);
  }
  const published = [];
  const reuseOnlyKeys = new Set(options.reuseOnlyKeys || []);

  for (const variant of variants.filter((item) => dueKeys.has(item.key))) {
    if (Number(clock()) >= deadlineMs) {
      throw new Error('Pages variant materialization exceeded the Actions deadline');
    }
    published.push(await renderVariant(
      variant,
      env,
      startedAt,
      reuseOnlyKeys.has(variant.key) ? { reuseOnly: true } : {},
    ));
  }

  return {
    ok: true,
    event: 'pages_read_model_actions_complete',
    force_all: forceAll,
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
