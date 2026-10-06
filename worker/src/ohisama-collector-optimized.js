import {
  API_BASE,
  DEFAULT_USER_AGENT,
  STATIONHEAD_AUTH_PAGE_URL,
} from './collector-config.js';
import {
  OHISAMA_COLLECTOR_CRON,
  fiveMinuteBucket,
  normalizeOhisamaSnapshot,
  registerOhisamaFollowerTarget,
} from './ohisama-collector-shared.js';
import { guardedOhisamaAuthRefresh } from './ohisama-auth-refresh-guard.js';
import { jwtExpiryMs, normalizeBearer } from './shared.js';

const STATE_ID = 'stationhead';
const DEFAULT_AUTH_HANDLE = 'ilys';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_REFRESH_BEFORE_MS = 60 * 60_000;
const DEFAULT_D1_STATE_CHECKPOINT_MS = 60 * 60_000;
export const OHISAMA_AUTH_HOT_STATE_KEY = 'stationhead/ohisama/collector-state.json';

export { OHISAMA_COLLECTOR_CRON };

function positiveNumber(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), maximum);
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectorHeaders({ authToken, deviceUid }, env, { guest = false } = {}) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    authorization: guest && !authToken ? '' : `Bearer ${authToken}`,
    'app-platform': 'web',
    'app-version': env.STATIONHEAD_APP_VERSION || env.SH_APP_VERSION || '1.0.0',
    'content-type': 'application/json',
    origin: 'https://www.stationhead.com',
    referer: guest ? STATIONHEAD_AUTH_PAGE_URL : 'https://www.stationhead.com/',
    'sth-device-uid': deviceUid,
    'user-agent': DEFAULT_USER_AGENT,
  };
}

function normalizeState(value = {}, env = {}) {
  const authToken = normalizeBearer(
    value.authToken || value.auth_token || env.STATIONHEAD_AUTH_TOKEN || env.SH_AUTH_TOKEN,
  );
  const deviceUid = String(
    value.deviceUid || value.device_uid || env.STATIONHEAD_DEVICE_UID || env.SH_DEVICE_UID || '',
  ).trim();
  return {
    authToken,
    deviceUid,
    tokenExpiresAt: finite(value.tokenExpiresAt ?? value.token_expires_at) || jwtExpiryMs(authToken),
    lastRunAt: finite(value.lastRunAt ?? value.last_run_at),
    lastSuccessAt: finite(value.lastSuccessAt ?? value.last_success_at),
    lastChannelId: finite(value.lastChannelId ?? value.last_channel_id),
    lastStationId: finite(value.lastStationId ?? value.last_station_id),
    d1CheckpointAt: finite(value.d1CheckpointAt ?? value.d1_checkpoint_at ?? value.updated_at),
  };
}

async function readHotState(env) {
  const bucket = env?.PAGES_RESPONSE_R2;
  if (typeof bucket?.get !== 'function') return null;
  try {
    const object = await bucket.get(OHISAMA_AUTH_HOT_STATE_KEY);
    if (!object) return null;
    const value = typeof object.json === 'function'
      ? await object.json()
      : JSON.parse(await object.text());
    if (!value || Number(value.version) !== 1) return null;
    return normalizeState(value, env);
  } catch {
    return null;
  }
}

async function writeHotState(env, state, now = Date.now()) {
  const bucket = env?.PAGES_RESPONSE_R2;
  if (typeof bucket?.put !== 'function') return false;
  try {
    const body = {
      version: 1,
      authToken: state.authToken || null,
      deviceUid: state.deviceUid || null,
      tokenExpiresAt: state.tokenExpiresAt || null,
      lastRunAt: state.lastRunAt || null,
      lastSuccessAt: state.lastSuccessAt || null,
      lastChannelId: state.lastChannelId || null,
      lastStationId: state.lastStationId || null,
      d1CheckpointAt: state.d1CheckpointAt || null,
      updatedAt: now,
    };
    await bucket.put(OHISAMA_AUTH_HOT_STATE_KEY, JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { version: '1', updated_at: String(now) },
    });
    return true;
  } catch {
    return false;
  }
}

async function readD1State(env) {
  const row = await env.OHISAMA_DB.prepare(`SELECT
      auth_token,device_uid,token_expires_at,last_run_at,last_success_at,
      last_channel_id,last_station_id,updated_at
    FROM sh_worker_collector_state WHERE id=? LIMIT 1`)
    .bind(STATE_ID)
    .first();
  return normalizeState(row || {}, env);
}

function collectorStateStatement(env, state, now, lastError = null) {
  return env.OHISAMA_DB.prepare(`INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,last_run_at,last_success_at,last_error,
      last_channel_id,last_station_id,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,
      device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,
      last_run_at=excluded.last_run_at,
      last_success_at=excluded.last_success_at,
      last_error=excluded.last_error,
      last_channel_id=excluded.last_channel_id,
      last_station_id=excluded.last_station_id,
      updated_at=excluded.updated_at`)
    .bind(
      STATE_ID,
      state.authToken || null,
      state.deviceUid || null,
      state.tokenExpiresAt || null,
      state.lastRunAt || null,
      state.lastSuccessAt || null,
      lastError,
      state.lastChannelId || null,
      state.lastStationId || null,
      now,
    );
}

async function writeD1State(env, state, now = Date.now()) {
  await collectorStateStatement(env, state, now).run();
  return { ...state, d1CheckpointAt: now };
}

async function readAuthState(env) {
  const hot = await readHotState(env);
  if (hot?.authToken && hot?.deviceUid) return hot;
  const state = await readD1State(env);
  await writeHotState(env, state).catch(() => false);
  return state;
}

async function persistAuthState(env, state, now = Date.now(), { forceD1 = false } = {}) {
  const hotWritten = await writeHotState(env, state, now);
  if (forceD1 || !hotWritten) return writeD1State(env, state, now);
  return state;
}

async function acquireGuestSession(env, fetchImpl = fetch) {
  const now = Date.now();
  const timeoutMs = positiveNumber(env.REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 30_000);
  const authHandle = String(env.STATIONHEAD_AUTH_HANDLE || DEFAULT_AUTH_HANDLE).trim().toLowerCase()
    || DEFAULT_AUTH_HANDLE;
  const deviceUid = crypto.randomUUID();
  const tokenResponse = await fetchImpl(`${API_BASE}/web/token`, {
    method: 'POST',
    headers: collectorHeaders({ authToken: '', deviceUid }, env, { guest: true }),
    body: '',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const authToken = normalizeBearer(tokenResponse.headers.get('authorization'));
  if (!tokenResponse.ok || !authToken) {
    throw new Error(`Stationhead guest token failed: ${tokenResponse.status}`);
  }
  const loginResponse = await fetchImpl(`${API_BASE}/web/guest/login`, {
    method: 'POST',
    headers: collectorHeaders({ authToken, deviceUid }, env, { guest: true }),
    body: '',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!loginResponse.ok) throw new Error(`Stationhead guest login failed: ${loginResponse.status}`);

  const verifyResponse = await fetchImpl(
    `${API_BASE}/station/handle/${encodeURIComponent(authHandle)}/guest`,
    {
      method: 'POST',
      headers: collectorHeaders({ authToken, deviceUid }, env, { guest: true }),
      body: '',
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!verifyResponse.ok) {
    throw new Error(`Stationhead ILYS auth verification failed: ${verifyResponse.status}`);
  }
  await verifyResponse.arrayBuffer().catch(() => {});

  const state = normalizeState({
    authToken,
    deviceUid,
    tokenExpiresAt: jwtExpiryMs(authToken),
    d1CheckpointAt: now,
  }, env);
  return persistAuthState(env, state, now, { forceD1: true });
}

async function refreshGuestSession(env, dependencies = {}, previousToken = '') {
  const fetchImpl = dependencies.fetch || fetch;
  return guardedOhisamaAuthRefresh(
    env,
    dependencies,
    () => acquireGuestSession(env, fetchImpl),
    () => readAuthState(env),
    previousToken,
  );
}

async function ensureSession(env, dependencies = {}) {
  const now = Number((dependencies.now || Date.now)());
  const refreshBeforeMs = positiveNumber(
    env.AUTH_REFRESH_BEFORE_MS,
    DEFAULT_REFRESH_BEFORE_MS,
    24 * 60 * 60_000,
  );
  const state = await readAuthState(env);
  const usable = Boolean(state.authToken && state.deviceUid)
    && (!state.tokenExpiresAt || state.tokenExpiresAt - now > refreshBeforeMs);
  if (usable) return state;
  return refreshGuestSession(env, dependencies, state.authToken || '');
}

async function requestChannel(env, dependencies = {}) {
  const fetchImpl = dependencies.fetch || fetch;
  const timeoutMs = positiveNumber(env.REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 30_000);
  const alias = String(env.CHANNEL_ALIAS || 'ohisama').trim() || 'ohisama';
  let state = await ensureSession(env, dependencies);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(`${API_BASE}/channels/alias/${encodeURIComponent(alias)}`, {
      headers: collectorHeaders(state, env),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      state = await refreshGuestSession(env, dependencies, state.authToken || '');
      continue;
    }
    if (!response.ok) throw new Error(`Stationhead API ${response.status}: channel`);

    const refreshed = normalizeBearer(response.headers.get('authorization'));
    if (refreshed && refreshed !== state.authToken) {
      state = normalizeState({
        ...state,
        authToken: refreshed,
        tokenExpiresAt: jwtExpiryMs(refreshed),
      }, env);
      state = await persistAuthState(env, state);
    }
    const payload = await response.json();
    return { payload, state, alias };
  }
  throw new Error('Stationhead channel request failed after auth refresh');
}

function snapshotStatement(env, snapshot, observedAt) {
  const minuteAt = fiveMinuteBucket(observedAt);
  const statement = env.OHISAMA_DB.prepare(`INSERT INTO sh_minute_facts(
      channel_id,minute_at,observed_at,station_id,is_broadcasting,listener_count,
      online_member_count,total_member_count,guest_count,reported_total_listens,
      stream_goal,reported_current_stream_count
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_id,minute_at) DO UPDATE SET
      observed_at=excluded.observed_at,
      station_id=excluded.station_id,
      is_broadcasting=excluded.is_broadcasting,
      listener_count=excluded.listener_count,
      online_member_count=excluded.online_member_count,
      total_member_count=excluded.total_member_count,
      guest_count=excluded.guest_count,
      reported_total_listens=excluded.reported_total_listens,
      stream_goal=excluded.stream_goal,
      reported_current_stream_count=excluded.reported_current_stream_count
    WHERE excluded.station_id IS NOT sh_minute_facts.station_id
       OR excluded.is_broadcasting IS NOT sh_minute_facts.is_broadcasting
       OR excluded.listener_count IS NOT sh_minute_facts.listener_count
       OR excluded.online_member_count IS NOT sh_minute_facts.online_member_count
       OR excluded.total_member_count IS NOT sh_minute_facts.total_member_count
       OR excluded.guest_count IS NOT sh_minute_facts.guest_count
       OR excluded.reported_total_listens IS NOT sh_minute_facts.reported_total_listens
       OR excluded.stream_goal IS NOT sh_minute_facts.stream_goal
       OR excluded.reported_current_stream_count IS NOT sh_minute_facts.reported_current_stream_count`)
    .bind(
      snapshot.channel_id,
      minuteAt,
      observedAt,
      snapshot.station_id,
      snapshot.is_broadcasting,
      snapshot.listener_count,
      snapshot.online_member_count,
      snapshot.total_member_count,
      snapshot.guest_count,
      snapshot.reported_total_listens,
      snapshot.stream_goal,
      snapshot.reported_current_stream_count,
    );
  return { minuteAt, statement };
}

async function persistSnapshot(env, snapshot, state, observedAt) {
  const { minuteAt, statement: fact } = snapshotStatement(env, snapshot, observedAt);
  const checkpointMs = positiveNumber(
    env.OHISAMA_D1_STATE_CHECKPOINT_MS,
    DEFAULT_D1_STATE_CHECKPOINT_MS,
    24 * 60 * 60_000,
  );
  const checkpointDue = !state.d1CheckpointAt
    || observedAt - state.d1CheckpointAt >= checkpointMs;
  let nextState = normalizeState({
    ...state,
    lastRunAt: observedAt,
    lastSuccessAt: observedAt,
    lastChannelId: snapshot.channel_id,
    lastStationId: snapshot.station_id,
    d1CheckpointAt: checkpointDue ? observedAt : state.d1CheckpointAt,
  }, env);

  if (checkpointDue && typeof env.OHISAMA_DB.batch === 'function') {
    await env.OHISAMA_DB.batch([fact, collectorStateStatement(env, nextState, observedAt)]);
  } else {
    await fact.run();
    if (checkpointDue) await collectorStateStatement(env, nextState, observedAt).run();
  }

  const hotWritten = await writeHotState(env, nextState, observedAt);
  if (!hotWritten && !checkpointDue) {
    nextState = await writeD1State(env, nextState, observedAt);
  }
  return { minuteAt, state: nextState, stateCheckpointed: checkpointDue || !hotWritten };
}

async function recordFailure(env, observedAt, error) {
  if (!env?.OHISAMA_DB?.prepare) return;
  const detail = String(error?.message || error).slice(0, 800);
  const state = await readHotState(env).catch(() => null);
  if (state) {
    await writeHotState(env, { ...state, lastRunAt: observedAt }, observedAt).catch(() => false);
  }
  await env.OHISAMA_DB.prepare(`INSERT INTO sh_worker_collector_state(
      id,last_run_at,last_error,updated_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      last_run_at=excluded.last_run_at,
      last_error=excluded.last_error,
      updated_at=excluded.updated_at`)
    .bind(STATE_ID, observedAt, detail, observedAt).run().catch(() => {});
}

export async function runOptimizedOhisamaCollectorScheduled(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  const cron = String(controller?.cron || '');
  if (cron !== OHISAMA_COLLECTOR_CRON) {
    return { skipped: true, reason: 'unsupported-ohisama-collector-cron', cron };
  }
  if (!env?.OHISAMA_DB?.prepare) throw new Error('OHISAMA_DB binding is missing');

  const observedAt = Number((dependencies.now || Date.now)());
  try {
    const { payload, state, alias } = await requestChannel(env, dependencies);
    const snapshot = normalizeOhisamaSnapshot(payload, alias);
    const persisted = await persistSnapshot(env, snapshot, state, observedAt);
    const registerTarget = dependencies.registerFollowerTarget || registerOhisamaFollowerTarget;
    const followerTargetAdded = await registerTarget(env, snapshot, observedAt, state).catch((error) => {
      console.warn(JSON.stringify({
        event: 'ohisama_follower_target_registration_failed',
        handle: snapshot.host_handle || null,
        error: String(error?.message || error).slice(0, 500),
      }));
      return false;
    });
    console.log(JSON.stringify({
      event: 'ohisama_collection_completed',
      observed_at: observedAt,
      minute_at: persisted.minuteAt,
      channel_id: snapshot.channel_id,
      station_id: snapshot.station_id,
      is_broadcasting: snapshot.is_broadcasting,
      listener_count: snapshot.listener_count,
      online_member_count: snapshot.online_member_count,
      total_member_count: snapshot.total_member_count,
      reported_total_listens: snapshot.reported_total_listens,
      host_handle: snapshot.host_handle,
      follower_target_added: followerTargetAdded,
      d1_state_checkpointed: persisted.stateCheckpointed,
    }));
    return {
      collected: true,
      observed_at: observedAt,
      minute_at: persisted.minuteAt,
      follower_target_added: followerTargetAdded,
      d1_state_checkpointed: persisted.stateCheckpointed,
      ...snapshot,
    };
  } catch (error) {
    await recordFailure(env, observedAt, error);
    throw error;
  }
}

export default {
  scheduled: runOptimizedOhisamaCollectorScheduled,
};
