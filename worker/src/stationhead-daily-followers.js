import {
  pagesR2ResponseKey,
  saveMaterializedR2Response,
} from './pages-response-r2.js';

const PROFILE_BASE = 'https://production1.stationhead.com/account/handle/';
const AUTH_STATE_ID = 'stationhead';
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const FOLLOWERS_READ_MODEL_KEY = 'followers';
const FOLLOWERS_READ_MODEL_CADENCE_SECONDS = 24 * 60 * 60;
const FOLLOWER_SOURCE_FIXED = 1;
const FOLLOWER_SOURCE_BUDDIES = 2;
const FOLLOWER_SOURCE_OHISAMA = 4;
const FOLLOWER_SOURCE_NOGIZAKA = 8;
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
});

export const STATIONHEAD_DAILY_FOLLOWER_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);

function nonNegativeInteger(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return handle && handle.length <= 128 ? handle : '';
}

function fixedHandleIndex(handle) {
  const index = STATIONHEAD_DAILY_FOLLOWER_HANDLES.indexOf(handle);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function orderedHandles(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizedHandle)
    .filter(Boolean))]
    .sort((a, b) => {
      const aFixed = fixedHandleIndex(a);
      const bFixed = fixedHandleIndex(b);
      if (aFixed !== bFixed) return aFixed - bFixed;
      return a.localeCompare(b);
    });
}

function followerMembership(handleValue, sourceMaskValue) {
  const handle = normalizedHandle(handleValue);
  const sourceMask = Number(sourceMaskValue || 0);
  if (handle === 'sakurazaka46jp') return { affiliation: '櫻坂46公式', group: 'sakurazaka46' };
  if (handle === 'nogizaka46smej') return { affiliation: '乃木坂46公式', group: 'nogizaka46' };
  if (handle === 'nogifan1ch') return { affiliation: 'Nogizaka', group: 'nogizaka46' };
  if (handle === 'sakuramankai' || handle === 'sakuramankai2') {
    return { affiliation: 'Buddies', group: 'sakurazaka46' };
  }
  if (sourceMask & FOLLOWER_SOURCE_BUDDIES) return { affiliation: 'Buddies', group: 'sakurazaka46' };
  if (sourceMask & FOLLOWER_SOURCE_OHISAMA) return { affiliation: 'Ohisama', group: 'hinatazaka46' };
  if (sourceMask & FOLLOWER_SOURCE_NOGIZAKA) return { affiliation: 'Nogizaka', group: 'nogizaka46' };
  return null;
}

function followerMemberships(handles, sourceMasks = {}) {
  const memberships = {};
  for (const handle of handles) {
    const membership = followerMembership(handle, sourceMasks?.[handle]);
    if (membership) memberships[handle] = membership;
  }
  return memberships;
}

function findAccount(value, handle, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  if (!Array.isArray(value)) {
    const followers = nonNegativeInteger(value.followers);
    if (followers != null && normalizedHandle(value.handle) === handle) return value;
  }
  for (const child of Object.values(value)) {
    const found = findAccount(child, handle, depth + 1);
    if (found) return found;
  }
  return null;
}

function fallbackAccount(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  if (!Array.isArray(value) && nonNegativeInteger(value.followers) != null) return value;
  for (const child of Object.values(value)) {
    const found = fallbackAccount(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function validDateKey(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text;
}

function offsetDateKey(date, days) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function normalizedFollowerRow(row, handles) {
  if (!validDateKey(row?.date)) return null;
  const normalized = { date: row.date };
  let values = 0;
  for (const handle of handles) {
    const followers = nonNegativeInteger(row?.[handle]);
    if (followers == null) continue;
    normalized[handle] = followers;
    values += 1;
  }
  return values ? normalized : null;
}

function normalizeFollowerRows(rows, handles) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizedFollowerRow(row, handles);
    if (!normalized) continue;
    const previous = byDate.get(normalized.date) || { date: normalized.date };
    byDate.set(normalized.date, { ...previous, ...normalized });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function followerSummary(rows, handles, latestDate) {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const latest = byDate.get(latestDate) || null;
  const previous = byDate.get(offsetDateKey(latestDate, -1));
  const previousWeek = byDate.get(offsetDateKey(latestDate, -7));
  return handles.map((handle) => {
    const followers = nonNegativeInteger(latest?.[handle]);
    const previousFollowers = nonNegativeInteger(previous?.[handle]);
    const previousWeekFollowers = nonNegativeInteger(previousWeek?.[handle]);
    return {
      handle,
      followers,
      previous_day_delta: followers != null && previousFollowers != null
        ? followers - previousFollowers
        : null,
      previous_week_delta: followers != null && previousWeekFollowers != null
        ? followers - previousWeekFollowers
        : null,
    };
  });
}

async function loadFollowerModel(r2) {
  if (typeof r2?.get !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is unavailable');
  const key = pagesR2ResponseKey(FOLLOWERS_READ_MODEL_KEY);
  const object = key ? await r2.get(key) : null;
  if (!object) return { handles: [...STATIONHEAD_DAILY_FOLLOWER_HANDLES], rows: [] };
  try {
    const payload = await object.json();
    const handles = orderedHandles([
      ...STATIONHEAD_DAILY_FOLLOWER_HANDLES,
      ...(Array.isArray(payload?.handles) ? payload.handles : []),
    ]);
    return { handles, rows: normalizeFollowerRows(payload?.rows, handles), memberships: payload?.memberships || {} };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'stationhead_followers_r2_history_invalid',
      error: String(error?.message || error).slice(0, 300),
    }));
    return { handles: [...STATIONHEAD_DAILY_FOLLOWER_HANDLES], rows: [] };
  }
}

export async function publishFollowerReadModel(
  r2,
  date,
  handles,
  followers,
  updatedAt,
  failures = [],
  sourceMasks = {},
) {
  const existing = await loadFollowerModel(r2);
  const allHandles = orderedHandles([...existing.handles, ...handles, ...Object.keys(followers)]);
  const rows = normalizeFollowerRows(existing.rows, allHandles);
  const previousToday = rows.find((row) => row.date === date) || { date };
  const next = normalizeFollowerRows([
    ...rows.filter((row) => row.date !== date),
    { ...previousToday, ...followers, date },
  ], allHandles);
  const body = JSON.stringify({
    ok: true,
    updated_at: updatedAt,
    latest_date: date,
    handles: allHandles,
    rows: next,
    accounts: followerSummary(next, allHandles, date),
    memberships: { ...existing.memberships, ...followerMemberships(allHandles, sourceMasks) },
    failures,
  });
  const saved = await saveMaterializedR2Response(
    r2,
    FOLLOWERS_READ_MODEL_KEY,
    body,
    200,
    JSON_HEADERS,
    updatedAt,
    FOLLOWERS_READ_MODEL_CADENCE_SECONDS,
  );
  if (!saved) throw new Error('followers R2 read model write failed');
  return next.length;
}

function bearer(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function resultRows(value) {
  return Array.isArray(value?.results) ? value.results : [];
}

function addSource(map, handleValue, sourceMask) {
  const handle = normalizedHandle(handleValue);
  if (!handle) return;
  map.set(handle, Number(map.get(handle) || 0) | sourceMask);
}

async function runStatements(db, statements) {
  if (!statements.length) return 0;
  if (typeof db.batch === 'function') {
    const results = await db.batch(statements);
    return results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
  }
  let changes = 0;
  for (const statement of statements) {
    const result = await statement.run();
    changes += Number(result?.meta?.changes || 0);
  }
  return changes;
}

export async function discoverStationheadFollowerTargets(env, discoveredAt = Date.now()) {
  if (typeof env?.OTHER_DB?.prepare !== 'function') throw new Error('OTHER_DB binding is unavailable');

  const existingPromise = env.OTHER_DB.prepare(`SELECT handle,source_mask
    FROM sh_stationhead_follower_targets ORDER BY handle`).all();
  const discoverBuddiesHosts = async () => {
    if (typeof env?.MINUTE_DB?.prepare !== 'function') {
      return { result: { results: [] }, error: 'MINUTE_DB binding is unavailable', reads: 0 };
    }
    try {
      const result = await env.MINUTE_DB.prepare(`SELECT DISTINCT LOWER(TRIM(h.current_handle)) AS handle
        FROM sh_broadcast_sessions AS s
        JOIN sh_hosts AS h ON h.id=s.host_id
        WHERE s.host_id IS NOT NULL
          AND h.current_handle IS NOT NULL
          AND TRIM(h.current_handle)<>''`).all();
      return { result, error: '', reads: 1 };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 500);
      console.warn(JSON.stringify({
        event: 'stationhead_follower_target_discovery_degraded',
        error: message,
      }));
      return { result: { results: [] }, error: message, reads: 1 };
    }
  };

  const [existingResult, buddiesState] = await Promise.all([
    existingPromise,
    discoverBuddiesHosts(),
  ]);
  const buddiesResult = buddiesState.result;

  const existing = new Map();
  for (const row of resultRows(existingResult)) {
    const handle = normalizedHandle(row?.handle);
    if (handle) existing.set(handle, Number(row?.source_mask || 0));
  }

  const desired = new Map(existing);
  for (const handle of STATIONHEAD_DAILY_FOLLOWER_HANDLES) addSource(desired, handle, FOLLOWER_SOURCE_FIXED);
  for (const row of resultRows(buddiesResult)) addSource(desired, row?.handle, FOLLOWER_SOURCE_BUDDIES);

  const mutations = [];
  for (const [handle, sourceMask] of desired) {
    const previousMask = Number(existing.get(handle) || 0);
    if ((previousMask & sourceMask) === sourceMask) continue;
    mutations.push(env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_follower_targets(
        handle,source_mask,first_seen_at
      ) VALUES(?,?,?)
      ON CONFLICT(handle) DO UPDATE SET
        source_mask=(sh_stationhead_follower_targets.source_mask | excluded.source_mask)
      WHERE (sh_stationhead_follower_targets.source_mask & excluded.source_mask)<>excluded.source_mask`)
      .bind(handle, sourceMask, discoveredAt));
  }

  const targetWrites = await runStatements(env.OTHER_DB, mutations);
  return {
    handles: orderedHandles([...desired.keys()]),
    source_masks: Object.fromEntries(desired),
    target_writes: targetWrites,
    buddies_discovered: resultRows(buddiesResult).length,
    buddies_discovery_error: buddiesState.error || null,
    other_d1_reads: 1,
    buddies_d1_reads: buddiesState.reads,
  };
}

export async function loadBuddiesFollowerSession(env) {
  if (typeof env?.BUDDIES_DB?.prepare !== 'function') throw new Error('BUDDIES_DB binding is unavailable');
  const row = await env.BUDDIES_DB.prepare(`SELECT auth_token,device_uid,token_expires_at
      FROM sh_worker_collector_state WHERE id=? LIMIT 1`)
    .bind(AUTH_STATE_ID)
    .first();
  if (!row?.auth_token || !row?.device_uid) throw new Error('Buddies Stationhead session is unavailable');
  return row;
}

export function jstDateKey(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('timestamp must be finite');
  return new Date(value + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isJstMidnightMinute(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  const jst = new Date(value + JST_OFFSET_MS);
  return jst.getUTCHours() === 0 && jst.getUTCMinutes() === 0;
}

export function followerProfileFromPayload(payload, expectedHandle) {
  const handle = normalizedHandle(expectedHandle);
  const account = findAccount(payload, handle) || fallbackAccount(payload);
  const followers = nonNegativeInteger(account?.followers);
  if (followers == null) throw new Error(`Stationhead followers missing for ${handle}`);
  const responseHandle = normalizedHandle(account?.handle);
  if (responseHandle && responseHandle !== handle) {
    throw new Error(`Stationhead profile handle mismatch: expected=${handle}, actual=${responseHandle}`);
  }
  return {
    handle,
    account_id: positiveInteger(account?.id ?? account?.account_id),
    followers,
  };
}

export async function fetchStationheadFollowerProfile(handle, options = {}) {
  const normalized = normalizedHandle(handle);
  if (!normalized) throw new Error('Stationhead handle is empty');
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('fetch is unavailable');
  const session = options.session;
  if (!session?.auth_token || !session?.device_uid) throw new Error('Stationhead session is unavailable');
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const response = await fetchFn(`${PROFILE_BASE}${encodeURIComponent(normalized)}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      'app-platform': 'web',
      'app-version': String(options.appVersion || '1.0.0'),
      origin: 'https://www.stationhead.com',
      referer: 'https://www.stationhead.com/',
      'sth-device-uid': String(session.device_uid),
      authorization: bearer(session.auth_token),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Stationhead profile request failed for ${normalized}: ${response.status}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Stationhead profile JSON failed for ${normalized}: ${String(error?.message || error)}`);
  }
  return followerProfileFromPayload(payload, normalized);
}

export async function collectStationheadDailyFollowers(env, scheduledAt = Date.now(), dependencies = {}) {
  if (typeof env?.OTHER_DB?.prepare !== 'function') throw new Error('OTHER_DB binding is unavailable');
  if (typeof env?.PAGES_RESPONSE_R2?.get !== 'function' || typeof env?.PAGES_RESPONSE_R2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is unavailable');
  }
  const observedAt = Number(scheduledAt);
  if (!Number.isFinite(observedAt)) throw new Error('scheduled timestamp is invalid');
  const now = dependencies.now || Date.now;
  const fetchFn = dependencies.fetchFn || globalThis.fetch;
  const timeoutMs = dependencies.timeoutMs;
  const loadSession = dependencies.loadSession || loadBuddiesFollowerSession;
  const discoverTargets = dependencies.discoverTargets || discoverStationheadFollowerTargets;

  const [session, targetState] = await Promise.all([
    loadSession(env),
    discoverTargets(env, observedAt),
  ]);
  const handles = orderedHandles(targetState?.handles || STATIONHEAD_DAILY_FOLLOWER_HANDLES);
  const settled = await Promise.allSettled(handles.map((handle) => (
    fetchStationheadFollowerProfile(handle, {
      fetchFn,
      timeoutMs,
      session,
      appVersion: env?.SH_APP_VERSION,
    })
  )));

  const profiles = [];
  const failures = [];
  settled.forEach((result, index) => {
    const handle = handles[index];
    if (result.status === 'fulfilled') profiles.push(result.value);
    else failures.push({ handle, error: String(result.reason?.message || result.reason).slice(0, 300) });
  });
  const criticalFailures = failures.filter(({ handle }) => STATIONHEAD_DAILY_FOLLOWER_HANDLES.includes(handle));
  if (criticalFailures.length) {
    throw new Error(`Stationhead fixed follower targets failed: ${criticalFailures.map(({ handle }) => handle).join(',')}`);
  }

  const followers = Object.fromEntries(profiles.map((profile) => [profile.handle, profile.followers]));
  const date = jstDateKey(observedAt);
  const collectedAt = Number(now()) || Date.now();
  const historyRows = await publishFollowerReadModel(
    env.PAGES_RESPONSE_R2,
    date,
    handles,
    followers,
    collectedAt,
    failures,
    targetState?.source_masks || {},
  );

  const dailyResult = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_daily_followers_v2 (
      observed_date_jst,scheduled_at,collected_at,followers_json,failures_json
    ) VALUES (?,?,?,?,?)
    ON CONFLICT(observed_date_jst) DO UPDATE SET
      scheduled_at=excluded.scheduled_at,
      collected_at=excluded.collected_at,
      followers_json=excluded.followers_json,
      failures_json=excluded.failures_json`)
    .bind(date, observedAt, collectedAt, JSON.stringify(followers), JSON.stringify(failures))
    .run();

  const dailyWrites = Number(dailyResult?.meta?.changes || 0);
  const targetWrites = Number(targetState?.target_writes || 0);
  return {
    observed_date_jst: date,
    scheduled_at: observedAt,
    collected_at: collectedAt,
    handles,
    followers,
    failures,
    history_rows: historyRows,
    inserted: dailyWrites > 0,
    buddies_auth_d1_reads: 1,
    buddies_discovery_d1_reads: Number(targetState?.buddies_d1_reads || 0),
    other_d1_reads: Number(targetState?.other_d1_reads || 0),
    target_rows_written: targetWrites,
    d1_rows_written: targetWrites + dailyWrites,
    r2_reads: 1,
    r2_writes: 1,
    http_requests: handles.length,
    http_successes: profiles.length,
    http_failures: failures.length,
  };
}
