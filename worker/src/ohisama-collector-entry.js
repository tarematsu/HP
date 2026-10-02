import {
  API_BASE,
  DEFAULT_USER_AGENT,
  STATIONHEAD_AUTH_PAGE_URL,
  firstDefined,
} from './collector-config.js';
import { jwtExpiryMs, normalizeBearer } from './shared.js';

const STATE_ID = 'stationhead';
const DEFAULT_AUTH_HANDLE = 'ilys';
const FOLLOWER_SOURCE_OHISAMA = 4;
const FIVE_MINUTES_MS = 5 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_REFRESH_BEFORE_MS = 60 * 60_000;

export const OHISAMA_COLLECTOR_CRON = '*/5 * * * *';

function positiveNumber(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), maximum);
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableBooleanCode(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 1;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return 0;
  return null;
}

function normalizedHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return handle && handle.length <= 128 ? handle : null;
}

export function fiveMinuteBucket(timestamp) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid observation timestamp');
  return Math.floor(parsed / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

export function normalizeOhisamaSnapshot(channel, expectedAlias = 'ohisama') {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
    throw new Error('Stationhead channel response is not an object');
  }
  const alias = String(channel.alias || channel.channel_alias || '').trim();
  if (!alias || alias.toLowerCase() !== String(expectedAlias).trim().toLowerCase()) {
    throw new Error(`Stationhead channel alias mismatch: expected ${expectedAlias}, got ${alias || '(missing)'}`);
  }
  const channelId = nullableNumber(firstDefined(channel.id, channel.channel_id));
  if (channelId === null) throw new Error('Stationhead channel id is missing');

  const station = channel.current_station || {};
  const party = station.streaming_party || channel.streaming_party || {};
  const broadcastHosts = Array.isArray(station.broadcast?.broadcasters)
  ? station.broadcast.broadcasters.filter((value) => (
    value && typeof value === 'object' && !Array.isArray(value) && value.is_host !== false
  ))
  : [];
const hostSources = [
  station.host,
  channel.host,
  station.current_host,
  channel.current_host,
  station.broadcaster,
  station.dj,
  station.account,
  station.host_account,
  station.owner,
  channel.owner,
  ...broadcastHosts,
].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const hostIdentities = hostSources.flatMap((value) => {
    const account = value.account;
    return account && typeof account === 'object' && !Array.isArray(account)
      ? [account, value]
      : [value];
  });
  const hostAccountId = nullableNumber(firstDefined(
    ...hostIdentities.flatMap((value) => [value.account_id, value.id]),
  ));
  const hostHandle = normalizedHandle(firstDefined(
    ...hostIdentities.flatMap((value) => [value.handle, value.username]),
    station.host_handle,
    station.host_username,
    channel.host_handle,
  ));
  return {
    channel_id: channelId,
    station_id: nullableNumber(firstDefined(channel.current_station_id, station.id)),
    is_broadcasting: nullableBooleanCode(station.is_broadcasting),
    listener_count: nullableNumber(firstDefined(station.listener_count, channel.listener_count)),
    online_member_count: nullableNumber(channel.online_member_count),
    total_member_count: nullableNumber(channel.total_member_count),
    guest_count: nullableNumber(firstDefined(station.guest_count, channel.guest_count)),
    reported_total_listens: nullableNumber(station.total_listens),
    stream_goal: nullableNumber(party.stream_goal),
    reported_current_stream_count: nullableNumber(party.current_stream_count),
    host_account_id: hostAccountId,
    host_handle: hostHandle,
  };
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

async function readAuthState(env) {
  const row = await env.OHISAMA_DB.prepare(`SELECT auth_token,device_uid,token_expires_at
    FROM sh_worker_collector_state WHERE id=? LIMIT 1`).bind(STATE_ID).first();
  const authToken = normalizeBearer(
    row?.auth_token || env.STATIONHEAD_AUTH_TOKEN || env.SH_AUTH_TOKEN,
  );
  const deviceUid = String(
    row?.device_uid || env.STATIONHEAD_DEVICE_UID || env.SH_DEVICE_UID || '',
  ).trim();
  return {
    authToken,
    deviceUid,
    tokenExpiresAt: Number(row?.token_expires_at || 0) || jwtExpiryMs(authToken),
  };
}

async function persistAuthState(env, state, now = Date.now()) {
  await env.OHISAMA_DB.prepare(`INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,updated_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,
      device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,
      updated_at=excluded.updated_at`)
    .bind(STATE_ID, state.authToken, state.deviceUid, state.tokenExpiresAt || null, now).run();
}

async function acquireGuestSession(env, fetchImpl = fetch) {
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

  const state = { authToken, deviceUid, tokenExpiresAt: jwtExpiryMs(authToken) };
  await persistAuthState(env, state);
  return state;
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
  return acquireGuestSession(env, dependencies.fetch || fetch);
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
      state = await acquireGuestSession(env, fetchImpl);
      continue;
    }
    if (!response.ok) throw new Error(`Stationhead API ${response.status}: channel`);

    const refreshed = normalizeBearer(response.headers.get('authorization'));
    if (refreshed && refreshed !== state.authToken) {
      state = { ...state, authToken: refreshed, tokenExpiresAt: jwtExpiryMs(refreshed) };
      await persistAuthState(env, state);
    }
    const payload = await response.json();
    return { payload, state, alias };
  }
  throw new Error('Stationhead channel request failed after auth refresh');
}

async function persistSnapshot(env, snapshot, state, observedAt) {
  const minuteAt = fiveMinuteBucket(observedAt);
  const fact = env.OHISAMA_DB.prepare(`INSERT INTO sh_minute_facts(
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
      reported_current_stream_count=excluded.reported_current_stream_count`)
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
  const collector = env.OHISAMA_DB.prepare(`INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,last_run_at,last_success_at,last_error,
      last_channel_id,last_station_id,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,
      device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,
      last_run_at=excluded.last_run_at,
      last_success_at=excluded.last_success_at,
      last_error=NULL,
      last_channel_id=excluded.last_channel_id,
      last_station_id=excluded.last_station_id,
      updated_at=excluded.updated_at`)
    .bind(
      STATE_ID,
      state.authToken,
      state.deviceUid,
      state.tokenExpiresAt || null,
      observedAt,
      observedAt,
      null,
      snapshot.channel_id,
      snapshot.station_id,
      observedAt,
    );
  if (typeof env.OHISAMA_DB.batch === 'function') {
    await env.OHISAMA_DB.batch([fact, collector]);
  } else {
    await fact.run();
    await collector.run();
  }
  return minuteAt;
}

export async function registerOhisamaFollowerTarget(env, snapshot, observedAt) {
  if (snapshot?.is_broadcasting !== 1 || !snapshot?.host_handle) return false;
  if (typeof env?.OTHER_DB?.prepare !== 'function') return false;
  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_follower_targets(
      handle,source_mask,first_seen_at,live_confirmed_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(handle) DO UPDATE SET
      source_mask=(sh_stationhead_follower_targets.source_mask | excluded.source_mask),
      live_confirmed_at=COALESCE(sh_stationhead_follower_targets.live_confirmed_at,excluded.live_confirmed_at)
    WHERE (sh_stationhead_follower_targets.source_mask & excluded.source_mask)=0
       OR sh_stationhead_follower_targets.live_confirmed_at IS NULL`)
    .bind(snapshot.host_handle, FOLLOWER_SOURCE_OHISAMA, observedAt, observedAt)
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function recordFailure(env, observedAt, error) {
  if (!env?.OHISAMA_DB?.prepare) return;
  const detail = String(error?.message || error).slice(0, 800);
  await env.OHISAMA_DB.prepare(`INSERT INTO sh_worker_collector_state(
      id,last_run_at,last_error,updated_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      last_run_at=excluded.last_run_at,
      last_error=excluded.last_error,
      updated_at=excluded.updated_at`)
    .bind(STATE_ID, observedAt, detail, observedAt).run().catch(() => {});
}

export async function runOhisamaCollectorScheduled(
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
    const minuteAt = await persistSnapshot(env, snapshot, state, observedAt);
    const registerTarget = dependencies.registerFollowerTarget || registerOhisamaFollowerTarget;
    const followerTargetAdded = await registerTarget(env, snapshot, observedAt).catch((error) => {
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
      minute_at: minuteAt,
      channel_id: snapshot.channel_id,
      station_id: snapshot.station_id,
      is_broadcasting: snapshot.is_broadcasting,
      listener_count: snapshot.listener_count,
      online_member_count: snapshot.online_member_count,
      total_member_count: snapshot.total_member_count,
      reported_total_listens: snapshot.reported_total_listens,
      host_handle: snapshot.host_handle,
      follower_target_added: followerTargetAdded,
    }));
    return {
      collected: true,
      observed_at: observedAt,
      minute_at: minuteAt,
      follower_target_added: followerTargetAdded,
      ...snapshot,
    };
  } catch (error) {
    await recordFailure(env, observedAt, error);
    throw error;
  }
}

export default {
  scheduled: runOhisamaCollectorScheduled,
};
