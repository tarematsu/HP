import { ensureAuthControlRow, readAuthState } from './auth-state.js';
import { configFromEnv } from './collector-config.js';
import { sanitizeFailureDetail } from './collector-failure.js';
import { jwtExpiryMs, normalizeBearer } from './shared.js';
import { stationheadInitialFollowerRegistrar } from './stationhead-source-runtime.js';
import { acquireStationheadGuestSession } from './stationhead-guest-session.js';
import { persistStationheadCollectorD1Credentials } from './stationhead-collector-state-d1.js';
import { claimStationheadAuthRefresh, finishStationheadAuthRefresh } from './stationhead-auth-control.js';
import {
  fetchStationheadChannelResponse,
  prepareStationheadChannelPayload,
} from './stationhead-collector-core.js';

const STATE_ID = 'stationhead';
const RAW_COLLECTION_QUEUE_OPTIONS = Object.freeze({ contentType: 'json' });
const SESSION_CACHE_TTL_MS = 5 * 60_000;
const MINUTE_MS = 60_000;
const sessionCache = new WeakMap();
const messageEncoder = new TextEncoder();
const COMPATIBILITY_FALLBACK_STAGES = new Set([
  'validate-channel',
  'extract-identifiers',
  'normalize-snapshot',
  'extract-queue',
]);

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function enabled(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ''));
}

function authConfig(env) {
  return {
    requestTimeoutMs: Math.min(positive(env.REQUEST_TIMEOUT_MS, 8_000), 30_000),
    refreshBeforeMs: positive(env.AUTH_REFRESH_BEFORE_MS, 3_600_000),
    cooldownMs: positive(env.AUTH_REFRESH_COOLDOWN_MS, 300_000),
    lockMs: positive(env.AUTH_LOCK_MS, 60_000),
  };
}

function collectorRequestConfig(env) {
  return {
    channelAlias: env.CHANNEL_ALIAS || 'buddies',
    appVersion: env.STATIONHEAD_APP_VERSION || env.SH_APP_VERSION || '1.0.0',
    requestTimeoutMs: Math.min(positive(env.REQUEST_TIMEOUT_MS, 15_000), 30_000),
  };
}

function snapshotAnalysisDue(env, observedAt) {
  const parsed = Number(env?.SNAPSHOT_PERSIST_INTERVAL_MS);
  const interval = !Number.isFinite(parsed) || parsed < MINUTE_MS
    ? MINUTE_MS
    : Math.min(Math.trunc(parsed), 60 * MINUTE_MS);
  if (interval <= MINUTE_MS) return true;
  const timestamp = Number(observedAt);
  if (!Number.isFinite(timestamp) || timestamp < 0) return true;
  return Math.floor(timestamp / interval) !== Math.floor((timestamp - MINUTE_MS) / interval);
}

function sessionCacheKey(env) {
  const db = env?.DB;
  return db && (typeof db === 'object' || typeof db === 'function') ? db : null;
}

function cachedSession(env, cfg, now = Date.now()) {
  const key = sessionCacheKey(env);
  if (!key) return null;
  const entry = sessionCache.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) sessionCache.delete(key);
    return null;
  }
  const state = entry.state;
  if (state.tokenExpiresAt && state.tokenExpiresAt - now <= cfg.refreshBeforeMs) {
    sessionCache.delete(key);
    return null;
  }
  return { ...state };
}

function rememberSession(env, state, now = Date.now()) {
  const key = sessionCacheKey(env);
  if (key && state?.authToken && state?.deviceUid) {
    sessionCache.set(key, {
      expiresAt: now + SESSION_CACHE_TTL_MS,
      state: { ...state },
    });
  }
  return state;
}

function forgetSession(env) {
  const key = sessionCacheKey(env);
  if (key) sessionCache.delete(key);
}

async function claimAuthLock(env, cfg) {
  const now = Date.now();
  return claimStationheadAuthRefresh(env.DB, { stateId: STATE_ID, now, lockMs: cfg.lockMs });
}

async function finishAuthAttempt(env, error = null) {
  const now = Date.now();
  await finishStationheadAuthRefresh(env.DB, { stateId: STATE_ID, now, error });
}

async function acquireSession(env) {
  const cfg = authConfig(env);
  const collectionConfig = configFromEnv(env);
  const session = await acquireStationheadGuestSession({
    appVersion: collectionConfig.appVersion,
    requestTimeoutMs: cfg.requestTimeoutMs,
  });
  const now = Date.now();
  await persistStationheadCollectorD1Credentials(env.DB, session, now, STATE_ID);
  await finishAuthAttempt(env);
  return readAuthState(env, STATE_ID);
}

export async function ensureSession(env) {
  const cfg = authConfig(env);
  const now = Date.now();
  const cached = cachedSession(env, cfg, now);
  if (cached) return cached;

  let state = await readAuthState(env, STATE_ID);
  if (!state.controlExists) {
    await ensureAuthControlRow(env, STATE_ID, now);
    state = { ...state, controlExists: true };
  }
  const ready = Boolean(state.authToken && state.deviceUid);
  const expiresSoon = Boolean(state.tokenExpiresAt && state.tokenExpiresAt - now <= cfg.refreshBeforeMs);
  if (ready && !expiresSoon) return rememberSession(env, state, now);
  if (ready && state.lastSuccessAt && now - state.lastSuccessAt < cfg.cooldownMs) {
    return rememberSession(env, state, now);
  }
  if (!await claimAuthLock(env, cfg)) {
    state = await readAuthState(env, STATE_ID);
    if (state.authToken && state.deviceUid) return rememberSession(env, state, now);
    throw new Error('Stationhead auth refresh is locked');
  }
  try {
    state = await acquireSession(env);
    return rememberSession(env, state, now);
  } catch (error) {
    forgetSession(env);
    await finishAuthAttempt(env, String(error?.message || error).slice(0, 800)).catch(() => {});
    throw error;
  }
}

function setPreparationFallback(base, detail) {
  Object.defineProperty(base, 'preparation_fallback', {
    value: Object.freeze(detail),
    enumerable: false,
    configurable: true,
  });
  return base;
}

function rawMessage(base, body, fallback = null) {
  base.message_version = 1;
  base.body = body;
  if (fallback) setPreparationFallback(base, fallback);
  return base;
}

async function directPreparedMessage(base, body, config, env) {
  let channel;
  try {
    channel = JSON.parse(body);
  } catch (error) {
    return rawMessage(base, body, {
      reason: 'invalid-json',
      stage: 'parse-channel-json',
      error: sanitizeFailureDetail(error?.message || error),
    });
  }
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
    return rawMessage(base, body, {
      reason: 'invalid-payload-shape',
      stage: 'validate-channel-root',
      error: 'channel payload must be an object',
    });
  }
  let stage = 'load-preparation-modules';
  try {
    const [queueAnalysis, materialization, snapshotAnalysis] = await Promise.all([
      import('./queue-analysis-transfer.js'),
      import('./queue-materialization.js'),
      import('./snapshot-analysis-transfer.js'),
    ]);
    const state = {
      channelId: base.auth?.collectorChannelId ?? null,
      stationId: base.auth?.collectorStationId ?? null,
    };
    stage = 'normalize-snapshot';
    const prepared = prepareStationheadChannelPayload(
      channel,
      config.channelAlias,
      state,
    );
    const snapshot = prepared.snapshot;
    const fullQueue = prepared.queue;
    stage = 'analyze-payload';
    const [preparedSnapshot, preparedQueue] = await Promise.all([
      snapshotAnalysisDue(env, base.observed_at)
        ? snapshotAnalysis.prepareSnapshotAnalysis(snapshot)
        : null,
      queueAnalysis.prepareQueueAnalysis(fullQueue),
    ]);
    stage = 'materialize-queue';
    const materialized = await materialization.prepareMaterializedQueue(
      env?.DB,
      fullQueue,
      preparedQueue,
      env,
    );
    base.message_version = 3;
    base.snapshot = snapshot;
    base.queue = materialized.queue;
    if (preparedSnapshot) base.snapshot_analysis = preparedSnapshot;
    if (materialized.analysis) base.queue_analysis = materialized.analysis;
    return base;
  } catch (error) {
    const detail = sanitizeFailureDetail(error?.message || error);
    const reason = String(error?.code || error?.name || 'prepared-message-failed').slice(0, 120);
    if (!COMPATIBILITY_FALLBACK_STAGES.has(stage)) {
      console.error(JSON.stringify({
        event: 'raw_collection_preparation_failed',
        observed_at: base.observed_at,
        reason,
        stage,
        error: detail,
      }));
      const failure = new Error(`prepared collection failed at ${stage}: ${detail}`);
      failure.name = 'PreparedCollectionError';
      failure.code = 'PREPARED_COLLECTION_FAILED';
      failure.stage = stage;
      throw failure;
    }
    base.message_version = 2;
    base.channel = channel;
    setPreparationFallback(base, { reason, stage, error: detail });
    return base;
  }
}

function ingestMetrics(result) {
  if (!result || typeof result !== 'object') return {};
  return {
    snapshot_inserted: result.snapshot_inserted === true,
    snapshot_skipped: result.snapshot_skipped === true,
    queue_items_written: Number(result.queue_items_written || 0),
    like_observations_written: Number(result.like_observations_written || 0),
    materialization_state_written: result.materialization_state_written === true,
    d1_rows_written_estimate: Number(result.d1_rows_written_estimate || 0),
    queue_send_attempts: Number(result.queue_send_attempts || 0),
    queue_send_ms: Number(result.queue_send_ms || 0),
    outbox_rows_written: Number(result.outbox_rows_written || 0),
    outbox_rows_deleted: Number(result.outbox_rows_deleted || 0),
    outbox_rows_quarantined: Number(result.outbox_rows_quarantined || 0),
    outbox_backoff_ms: Number(result.outbox_backoff_ms || 0),
    pending_flushed: Number(result.pending_flushed || 0),
  };
}

export async function collectRawChannel(env, dependencies = {}) {
  const inlinePipeline = enabled(env?.COLLECTOR_INLINE_PIPELINE_ENABLED);
  const rawCollectionQueue = env?.RAW_COLLECTION_QUEUE;
  const ingestInline = dependencies.ingestRawCollection;
  if (inlinePipeline && typeof ingestInline !== 'function') {
    throw new Error('inline raw collection ingest handler is missing');
  }
  if (!inlinePipeline && typeof rawCollectionQueue?.send !== 'function') {
    throw new Error('RAW_COLLECTION_QUEUE binding is missing');
  }

  const state = await (dependencies.ensureSession || ensureSession)(env);
  const inlinePreparation = inlinePipeline || (!env.DB && dependencies.inlinePreparation !== false);
  const config = inlinePreparation ? configFromEnv(env) : collectorRequestConfig(env);
  const observedAt = Date.now();
  const request = await fetchStationheadChannelResponse(
    state,
    config,
    dependencies.fetch || fetch,
  );
  const { response } = request;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) forgetSession(env);
    throw new Error(`Stationhead API ${response.status}: channel`);
  }

  const body = await response.text();
  const payloadBytes = messageEncoder.encode(body).byteLength;
  const refreshed = request.refreshedAuthToken;
  const persistCredentials = !state.collectorUpdatedAt
    || Boolean(refreshed && refreshed !== state.authToken);
  const activeToken = refreshed || state.authToken;
  const activeExpiry = refreshed ? jwtExpiryMs(refreshed) : state.tokenExpiresAt;
  const base = {
    message_type: 'stationhead-raw-channel',
    observed_at: observedAt,
    channel_alias: config.channelAlias,
    persist_credentials: persistCredentials,
    auth: {
      authToken: activeToken,
      deviceUid: state.deviceUid,
      tokenExpiresAt: activeExpiry,
      collectorLastRunAt: state.collectorLastRunAt,
      collectorLastSuccessAt: state.collectorLastSuccessAt,
      collectorLastError: state.collectorLastError,
      collectorChannelId: state.collectorChannelId,
      collectorStationId: state.collectorStationId,
    },
  };
  const message = inlinePreparation
    ? await directPreparedMessage(base, body, config, env)
    : rawMessage(base, body);
  const fallback = message.preparation_fallback || null;
  if (fallback) {
    console.warn(JSON.stringify({
      event: 'raw_collection_preparation_fallback',
      observed_at: observedAt,
      message_version: Number(message.message_version || 0),
      reason: fallback.reason,
      stage: fallback.stage,
      error: fallback.error,
    }));
  }
  const ingestResult = inlinePipeline
    ? await ingestInline(env, message, { inline: true })
    : await rawCollectionQueue.send(message, RAW_COLLECTION_QUEUE_OPTIONS);
  const registerInitialFollower = stationheadInitialFollowerRegistrar(config.channelAlias);
  if (registerInitialFollower && message.snapshot) {
    await registerInitialFollower(env, message.snapshot, observedAt, {
      auth_token: activeToken,
      device_uid: state.deviceUid,
    }).catch((error) => console.warn(JSON.stringify({
      event: 'stationhead_initial_followers_failed',
      channel_alias: config.channelAlias,
      error: String(error?.message || error).slice(0, 300),
    })));
  }
  rememberSession(env, {
    ...state,
    authToken: activeToken,
    tokenExpiresAt: activeExpiry,
    collectorLastRunAt: observedAt,
    collectorLastSuccessAt: observedAt,
    collectorLastError: null,
    collectorUpdatedAt: state.collectorUpdatedAt || observedAt,
  }, observedAt);

  let queueTotalTracks = 0;
  let queueMaterializedTracks = 0;
  if (inlinePreparation) {
    const queue = message.queue;
    const trackCount = queue?.tracks?.length || 0;
    queueTotalTracks = Number(queue?.total_track_count || trackCount);
    queueMaterializedTracks = Number(queue?.materialized_track_count || trackCount);
  }
  const metrics = ingestMetrics(ingestResult);
  const event = inlinePipeline ? 'raw_collection_completed_inline' : 'raw_collection_enqueued';
  console.log(JSON.stringify({
    event,
    observed_at: observedAt,
    payload_chars: body.length,
    payload_bytes: payloadBytes,
    queue_total_tracks: queueTotalTracks,
    queue_materialized_tracks: queueMaterializedTracks,
    prepared_fallback: fallback ? 1 : 0,
    prepared_fallback_reason: fallback?.reason || null,
    prepared_fallback_stage: fallback?.stage || null,
    ...metrics,
  }));
  return {
    inline: inlinePipeline,
    message_version: Number(message.message_version || 0),
    observed_at: observedAt,
    payload_bytes: payloadBytes,
    queue_total_tracks: queueTotalTracks,
    queue_materialized_tracks: queueMaterializedTracks,
    prepared_fallback: fallback ? 1 : 0,
    prepared_fallback_reason: fallback?.reason || null,
    prepared_fallback_stage: fallback?.stage || null,
    ...metrics,
  };
}

export function resetRawCollectorSessionCacheForTests() {
  // WeakMap cannot be cleared; tests use fresh DB identities. This export gives
  // callers a stable seam without exposing cached credentials.
}

export default {
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(collectRawChannel(env));
  },
};
