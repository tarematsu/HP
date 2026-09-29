import {
  pagesR2ResponseKey,
  saveMaterializedR2Response,
} from './pages-response-r2.js';

const PROFILE_BASE = 'https://www.stationhead.com/api/account/handle/';
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const FOLLOWERS_READ_MODEL_KEY = 'followers';
const FOLLOWERS_READ_MODEL_CADENCE_SECONDS = 24 * 60 * 60;
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
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedHandle(value) {
  return String(value || '').trim().toLowerCase();
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

function normalizedFollowerRow(row) {
  if (!validDateKey(row?.date)) return null;
  const normalized = { date: row.date };
  for (const handle of STATIONHEAD_DAILY_FOLLOWER_HANDLES) {
    const followers = nonNegativeInteger(row?.[handle]);
    if (followers == null) return null;
    normalized[handle] = followers;
  }
  return normalized;
}

function normalizeFollowerRows(rows) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizedFollowerRow(row);
    if (normalized) byDate.set(normalized.date, normalized);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function followerSummary(rows) {
  const latest = rows.at(-1);
  if (!latest) return [];
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const previous = byDate.get(offsetDateKey(latest.date, -1));
  const previousWeek = byDate.get(offsetDateKey(latest.date, -7));
  return STATIONHEAD_DAILY_FOLLOWER_HANDLES.map((handle) => ({
    handle,
    followers: latest[handle],
    previous_day_delta: previous ? latest[handle] - previous[handle] : null,
    previous_week_delta: previousWeek ? latest[handle] - previousWeek[handle] : null,
  }));
}

async function loadFollowerRows(r2) {
  if (typeof r2?.get !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is unavailable');
  const key = pagesR2ResponseKey(FOLLOWERS_READ_MODEL_KEY);
  const object = key ? await r2.get(key) : null;
  if (!object) return [];
  try {
    const payload = await object.json();
    return normalizeFollowerRows(payload?.rows);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'stationhead_followers_r2_history_invalid',
      error: String(error?.message || error).slice(0, 300),
    }));
    return [];
  }
}

async function publishFollowerReadModel(r2, date, followers, updatedAt) {
  const rows = await loadFollowerRows(r2);
  const next = normalizeFollowerRows([
    ...rows,
    { date, ...followers },
  ]);
  const body = JSON.stringify({
    ok: true,
    updated_at: updatedAt,
    latest_date: next.at(-1)?.date || null,
    handles: STATIONHEAD_DAILY_FOLLOWER_HANDLES,
    rows: next,
    accounts: followerSummary(next),
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
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const response = await fetchFn(`${PROFILE_BASE}${encodeURIComponent(normalized)}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; sh-daily-followers/1.0)',
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
  const profiles = await Promise.all(STATIONHEAD_DAILY_FOLLOWER_HANDLES.map((handle) => (
    fetchStationheadFollowerProfile(handle, { fetchFn, timeoutMs })
  )));
  const followers = Object.fromEntries(profiles.map((profile) => [profile.handle, profile.followers]));
  const date = jstDateKey(observedAt);
  const collectedAt = Number(now()) || Date.now();

  // Publish the display read model before the D1 insert. If the process is retried,
  // the R2 row is replaced by date and the eventual D1 insert remains a single row.
  const historyRows = await publishFollowerReadModel(
    env.PAGES_RESPONSE_R2,
    date,
    followers,
    collectedAt,
  );

  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_daily_followers (
      observed_date_jst,scheduled_at,collected_at,
      sakuramankai,sakuramankai2,sakurazaka46jp,nogizaka46smej
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(observed_date_jst) DO NOTHING`)
    .bind(
      date,
      observedAt,
      collectedAt,
      followers.sakuramankai,
      followers.sakuramankai2,
      followers.sakurazaka46jp,
      followers.nogizaka46smej,
    )
    .run();

  return {
    observed_date_jst: date,
    scheduled_at: observedAt,
    collected_at: collectedAt,
    followers,
    history_rows: historyRows,
    inserted: Number(result?.meta?.changes || 0) > 0,
    d1_reads: 0,
    d1_rows_written: Number(result?.meta?.changes || 0),
    r2_reads: 1,
    r2_writes: 1,
    http_requests: STATIONHEAD_DAILY_FOLLOWER_HANDLES.length,
  };
}
