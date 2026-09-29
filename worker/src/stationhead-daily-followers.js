const PROFILE_BASE = 'https://www.stationhead.com/api/account/handle/';
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

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
    inserted: Number(result?.meta?.changes || 0) > 0,
    d1_reads: 0,
    d1_rows_written: Number(result?.meta?.changes || 0),
    http_requests: STATIONHEAD_DAILY_FOLLOWER_HANDLES.length,
  };
}
