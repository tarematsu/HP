import { API_BASE, configFromEnv, shHeaders } from './collector-config.js';
import { jwtExpiryMs, normalizeBearer } from './shared.js';
import {
  collectStationheadDailyFollowers,
  jstDateKey,
} from './stationhead-daily-followers.js';

const AUTH_STATE_ID = 'stationhead';
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_REFRESH_BEFORE_MS = 60 * 60_000;
const DEFAULT_AUTH_LOCK_MS = 60_000;
const AUTH_WAIT_ATTEMPTS = 8;
const AUTH_WAIT_INTERVAL_MS = 250;
const RETRY_MINUTES = Object.freeze(new Set([0, 5, 10]));

function positive(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizedSession(value = {}) {
  const authToken = normalizeBearer(value.authToken || value.auth_token);
  const deviceUid = String(value.deviceUid || value.device_uid || '').trim();
  const tokenExpiresAt = Number(value.tokenExpiresAt || value.token_expires_at || 0) || jwtExpiryMs(authToken);
  if (!authToken || !deviceUid) throw new Error('Buddies Stationhead session is unavailable');
  return { authToken, deviceUid, tokenExpiresAt };
}

function followerSessionForCollector(value) {
  const session = normalizedSession(value);
  return {
    auth_token: session.authToken,
    device_uid: session.deviceUid,
    token_expires_at: session.tokenExpiresAt || null,
  };
}

function authUsable(session, now, refreshBeforeMs) {
  if (!session?.authToken || !session?.deviceUid) return false;
  return !session.tokenExpiresAt || session.tokenExpiresAt - now > refreshBeforeMs;
}

async function readFollowerAuthState(env) {
  if (typeof env?.BUDDIES_DB?.prepare !== 'function') throw new Error('BUDDIES_DB binding is unavailable');
  const row = await env.BUDDIES_DB.prepare(`SELECT auth_token,device_uid,token_expires_at
      FROM sh_worker_collector_state WHERE id=? LIMIT 1`)
    .bind(AUTH_STATE_ID)
    .first();
  if (!row?.auth_token || !row?.device_uid) return null;
  return normalizedSession(row);
}

async function ensureAuthControlRow(env, now) {
  await env.BUDDIES_DB.prepare(`INSERT OR IGNORE INTO sh_worker_auth_control(id,updated_at)
      VALUES(?,?)`)
    .bind(AUTH_STATE_ID, now)
    .run();
}

async function claimAuthRefresh(env, now) {
  const lockMs = positive(env?.AUTH_LOCK_MS, DEFAULT_AUTH_LOCK_MS);
  await ensureAuthControlRow(env, now);
  const result = await env.BUDDIES_DB.prepare(`UPDATE sh_worker_auth_control SET
      lock_until=?,last_attempt_at=?,updated_at=?
    WHERE id=? AND COALESCE(lock_until,0)<?`)
    .bind(now + lockMs, now, now, AUTH_STATE_ID, now)
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function finishAuthRefresh(env, error, now) {
  await env.BUDDIES_DB.prepare(`UPDATE sh_worker_auth_control SET
      last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,
      last_error=?,lock_until=0,updated_at=? WHERE id=?`)
    .bind(error, now, error, now, AUTH_STATE_ID)
    .run();
}

function guestHeaders(env, deviceUid, authToken = '') {
  const config = configFromEnv(env);
  return {
    ...shHeaders({ authToken, deviceUid }, config),
    ...(authToken ? {} : { authorization: '' }),
  };
}

async function acquireFollowerSession(env, dependencies = {}) {
  const request = dependencies.authFetchFn || globalThis.fetch;
  if (typeof request !== 'function') throw new Error('fetch is unavailable for Stationhead authentication');
  const timeoutMs = positive(env?.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 30_000);
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const deviceUid = randomUUID();

  const tokenResponse = await request(`${API_BASE}/web/token`, {
    method: 'POST',
    headers: guestHeaders(env, deviceUid),
    body: '',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const authToken = normalizeBearer(tokenResponse.headers.get('authorization'));
  if (!tokenResponse.ok || !authToken) {
    throw new Error(`Stationhead guest token failed: ${tokenResponse.status}`);
  }

  const loginResponse = await request(`${API_BASE}/web/guest/login`, {
    method: 'POST',
    headers: guestHeaders(env, deviceUid, authToken),
    body: '',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!loginResponse.ok) throw new Error(`Stationhead guest login failed: ${loginResponse.status}`);

  return {
    authToken,
    deviceUid,
    tokenExpiresAt: jwtExpiryMs(authToken) || null,
  };
}

async function saveFollowerSession(env, session, now) {
  await env.BUDDIES_DB.prepare(`INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,updated_at
    ) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,
      device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,
      updated_at=excluded.updated_at`)
    .bind(AUTH_STATE_ID, session.authToken, session.deviceUid, session.tokenExpiresAt || null, now)
    .run();
}

async function waitForPeerRefresh(env, previousToken, dependencies = {}) {
  const sleepFn = dependencies.sleep || sleep;
  for (let attempt = 0; attempt < AUTH_WAIT_ATTEMPTS; attempt += 1) {
    await sleepFn(AUTH_WAIT_INTERVAL_MS);
    const state = await readFollowerAuthState(env);
    if (state && state.authToken !== previousToken) return state;
  }
  return null;
}

export async function ensureFreshFollowerSession(env, dependencies = {}, options = {}) {
  const nowFn = dependencies.now || Date.now;
  const now = Number(nowFn()) || Date.now();
  const refreshBeforeMs = positive(env?.AUTH_REFRESH_BEFORE_MS, DEFAULT_REFRESH_BEFORE_MS);
  const initial = await readFollowerAuthState(env);
  if (!options.force && authUsable(initial, now, refreshBeforeMs)) return initial;

  const previousToken = initial?.authToken || '';
  if (!await claimAuthRefresh(env, now)) {
    const refreshed = await waitForPeerRefresh(env, previousToken, dependencies);
    if (refreshed && authUsable(refreshed, Number(nowFn()) || Date.now(), 0)) return refreshed;
    throw new Error('Stationhead auth refresh is locked');
  }

  try {
    const acquired = await (dependencies.acquireSession || acquireFollowerSession)(env, dependencies);
    const session = normalizedSession(acquired);
    const savedAt = Number(nowFn()) || Date.now();
    await saveFollowerSession(env, session, savedAt);
    await finishAuthRefresh(env, null, savedAt);
    return session;
  } catch (error) {
    const failedAt = Number(nowFn()) || Date.now();
    const message = String(error?.message || error).slice(0, 800);
    await finishAuthRefresh(env, message, failedAt).catch(() => {});
    throw error;
  }
}

export function isJstFollowerCollectionMinute(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  const jst = new Date(value + JST_OFFSET_MS);
  return jst.getUTCHours() === 0 && RETRY_MINUTES.has(jst.getUTCMinutes());
}

function isRetryAttempt(timestamp) {
  const jst = new Date(Number(timestamp) + JST_OFFSET_MS);
  return jst.getUTCHours() !== 0 || jst.getUTCMinutes() !== 0;
}

async function hasDailyFollowerRow(env, date) {
  const row = await env.OTHER_DB.prepare(`SELECT observed_date_jst
      FROM sh_stationhead_daily_followers_v2
      WHERE observed_date_jst=? LIMIT 1`)
    .bind(date)
    .first();
  return Boolean(row?.observed_date_jst);
}

async function persistFollowerFailure(env, scheduledAt, error, details = [], now = Date.now()) {
  if (typeof env?.OTHER_DB?.prepare !== 'function') return false;
  const date = jstDateKey(scheduledAt);
  const message = String(error?.message || error).slice(0, 800);
  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_daily_follower_failures(
      observed_date_jst,scheduled_at,failed_at,error,details_json
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(observed_date_jst,scheduled_at) DO UPDATE SET
      failed_at=excluded.failed_at,
      error=excluded.error,
      details_json=excluded.details_json`)
    .bind(date, scheduledAt, now, message, JSON.stringify(details))
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}

function handleFromProfileUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) || '');
  } catch {
    return '';
  }
}

export async function collectStationheadDailyFollowersResilient(
  env,
  scheduledAt = Date.now(),
  dependencies = {},
) {
  const observedAt = Number(scheduledAt);
  if (!Number.isFinite(observedAt)) throw new Error('scheduled timestamp is invalid');
  const date = jstDateKey(observedAt);
  const nowFn = dependencies.now || Date.now;

  if (isRetryAttempt(observedAt) && await hasDailyFollowerRow(env, date)) {
    return {
      observed_date_jst: date,
      scheduled_at: observedAt,
      skipped: true,
      skip_reason: 'already-collected',
    };
  }

  const request = dependencies.fetchFn || globalThis.fetch;
  if (typeof request !== 'function') throw new Error('fetch is unavailable');
  const ensureSession = dependencies.ensureSession
    || ((options) => ensureFreshFollowerSession(env, dependencies, options));
  const collectFollowers = dependencies.collectFollowers || collectStationheadDailyFollowers;
  const requestFailures = [];
  let refreshPromise = null;

  try {
    let session = normalizedSession(await ensureSession({ force: false }));
    const loadSession = async () => followerSessionForCollector(session);
    const resilientFetch = async (url, init = {}) => {
      let response = await request(url, init);
      if (response.status === 401 || response.status === 403) {
        refreshPromise ||= Promise.resolve(ensureSession({ force: true }));
        session = normalizedSession(await refreshPromise);
        const headers = new Headers(init.headers || {});
        headers.set('authorization', `Bearer ${session.authToken}`);
        headers.set('sth-device-uid', session.deviceUid);
        const timeoutMs = positive(env?.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 30_000);
        response = await request(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      }
      if (!response.ok) {
        requestFailures.push({
          handle: handleFromProfileUrl(url),
          status: response.status,
        });
      }
      return response;
    };

    return await collectFollowers(env, observedAt, {
      ...dependencies,
      fetchFn: resilientFetch,
      loadSession,
    });
  } catch (error) {
    const failedAt = Number(nowFn()) || Date.now();
    await persistFollowerFailure(env, observedAt, error, requestFailures, failedAt).catch((persistError) => {
      console.error(JSON.stringify({
        event: 'stationhead_daily_followers_failure_persist_failed',
        scheduled_at: observedAt,
        error: String(persistError?.message || persistError).slice(0, 800),
      }));
    });
    throw error;
  }
}
