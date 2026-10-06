import { pagesR2ResponseKey } from './pages-response-r2.js';
import { STATIONHEAD_FOLLOWER_SOURCE, stationheadFollowerMembership } from './stationhead-follower-membership.js';

const API_BASE = 'https://production1.stationhead.com';
const WEB_BASE = 'https://www.stationhead.com';
const PROFILE_BASE = `${API_BASE}/account/handle/`;
const JST_OFFSET_MS = 9 * 60 * 60_000;
const CADENCE_SECONDS = 24 * 60 * 60;
const SOURCE_FIXED = STATIONHEAD_FOLLOWER_SOURCE.fixed;
const SOURCE_BUDDIES = STATIONHEAD_FOLLOWER_SOURCE.buddies;
const SOURCE_OHISAMA = STATIONHEAD_FOLLOWER_SOURCE.ohisama;
const SOURCE_NOGIZAKA = STATIONHEAD_FOLLOWER_SOURCE.nogizaka;
const HANDLE_RE = /^[a-z0-9._-]{1,64}$/;
const EXCLUDED_HANDLES = new Set(['46fm', 'buddy46']);

export const FIXED_FOLLOWER_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);

function normalizeHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return HANDLE_RE.test(handle) && !EXCLUDED_HANDLES.has(handle) ? handle : '';
}

function fixedIndex(handle) {
  const index = FIXED_FOLLOWER_HANDLES.indexOf(handle);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function orderedHandles(values) {
  return [...new Set(values.map(normalizeHandle).filter(Boolean))].sort((a, b) => {
    const ai = fixedIndex(a);
    const bi = fixedIndex(b);
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
}

export function normalizeFollowerTargets(rows = []) {
  const byHandle = new Map(FIXED_FOLLOWER_HANDLES.map((handle) => [handle, SOURCE_FIXED]));
  let ignored = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const handle = normalizeHandle(row?.handle);
    if (!handle) {
      ignored += 1;
      continue;
    }
    const mask = Math.max(0, Math.trunc(Number(row?.source_mask) || 0));
    byHandle.set(handle, Number(byHandle.get(handle) || 0) | mask);
  }
  return {
    targets: orderedHandles([...byHandle.keys()]).map((handle) => ({
      handle,
      source_mask: Number(byHandle.get(handle) || 0),
    })),
    ignored,
  };
}

function jstDateKey(timestamp) {
  return new Date(Number(timestamp) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function offsetDateKey(day, offsetDays) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function membership(handle, sourceMask) {
  return stationheadFollowerMembership(handle, sourceMask);
}

function parsedFollowerJson(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([rawHandle, rawFollowers]) => {
      const handle = normalizeHandle(rawHandle);
      const followers = nonNegativeInteger(rawFollowers);
      return handle && followers != null ? [[handle, followers]] : [];
    }));
  } catch {
    return {};
  }
}

export function buildFollowerReadModel({ historyRows = [], targets = [], latestDate, updatedAt, failures = [] } = {}) {
  const sourceMasks = new Map();
  for (const target of targets) {
    const handle = normalizeHandle(target?.handle);
    if (handle) sourceMasks.set(handle, Number(sourceMasks.get(handle) || 0) | Math.max(0, Number(target?.source_mask) || 0));
  }
  for (const handle of FIXED_FOLLOWER_HANDLES) sourceMasks.set(handle, Number(sourceMasks.get(handle) || 0) | SOURCE_FIXED);
  const handles = orderedHandles([...sourceMasks.keys()]);
  const allowed = new Set(handles);
  const rows = [];
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const date = String(row?.observed_date_jst || row?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const followers = parsedFollowerJson(row?.followers_json != null ? row.followers_json : JSON.stringify(row));
    const filtered = Object.fromEntries(Object.entries(followers).filter(([handle]) => allowed.has(handle)));
    if (Object.keys(filtered).length) rows.push({ date, ...filtered });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const latest = byDate.get(latestDate) || { date: latestDate };
  const previous = byDate.get(offsetDateKey(latestDate, -1));
  const previousWeek = byDate.get(offsetDateKey(latestDate, -7));
  const accounts = handles.map((handle) => {
    const followers = nonNegativeInteger(latest?.[handle]);
    const day = nonNegativeInteger(previous?.[handle]);
    const week = nonNegativeInteger(previousWeek?.[handle]);
    return {
      handle,
      followers,
      previous_day_delta: followers != null && day != null ? followers - day : null,
      previous_week_delta: followers != null && week != null ? followers - week : null,
    };
  });
  const memberships = {};
  for (const handle of handles) {
    const value = membership(handle, Number(sourceMasks.get(handle) || 0));
    if (value) memberships[handle] = value;
  }
  return { ok: true, updated_at: Number(updatedAt), latest_date: latestDate, handles, rows, accounts, memberships, failures };
}

function browserHeaders(deviceUid, token = '', appVersion = '1.0.0', referer = `${WEB_BASE}/`) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    'app-platform': 'web',
    'app-version': appVersion,
    origin: WEB_BASE,
    referer,
    'sth-device-uid': deviceUid,
    'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    ...(token ? { authorization: `Bearer ${token.replace(/^Bearer\s+/i, '')}` } : {}),
  };
}

async function checkedFetch(fetchFn, url, options, label) {
  const response = await fetchFn(url, options);
  if (!response.ok) {
    const error = new Error(`${label} failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function guestSession(fetchFn, appVersion) {
  const deviceUid = crypto.randomUUID();
  const tokenResponse = await checkedFetch(fetchFn, `${API_BASE}/web/token`, {
    method: 'POST',
    headers: { ...browserHeaders(deviceUid, '', appVersion, `${WEB_BASE}/c/ilys`), 'content-type': 'application/json' },
    body: '',
    signal: AbortSignal.timeout(10_000),
  }, 'Stationhead guest token');
  const token = String(tokenResponse.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Stationhead guest token is missing');
  await checkedFetch(fetchFn, `${API_BASE}/web/guest/login`, {
    method: 'POST',
    headers: { ...browserHeaders(deviceUid, token, appVersion, `${WEB_BASE}/c/ilys`), 'content-type': 'application/json' },
    body: '',
    signal: AbortSignal.timeout(10_000),
  }, 'Stationhead guest login');
  return { token, deviceUid };
}

async function fetchProfile(handle, session, fetchFn, appVersion) {
  const response = await checkedFetch(fetchFn, `${PROFILE_BASE}${encodeURIComponent(handle)}`, {
    headers: browserHeaders(session.deviceUid, session.token, appVersion),
    signal: AbortSignal.timeout(10_000),
  }, `Stationhead profile ${handle}`);
  const followers = nonNegativeInteger((await response.json())?.followers);
  if (followers == null) throw new Error(`Stationhead profile ${handle} has no follower count`);
  return followers;
}

async function collectProfiles(targets, session, fetchFn, appVersion, concurrency = 4) {
  const output = new Array(targets.length);
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const index = next++;
      const target = targets[index];
      try {
        output[index] = { ok: true, handle: target.handle, followers: await fetchProfile(target.handle, session, fetchFn, appVersion) };
      } catch (error) {
        output[index] = { ok: false, handle: target.handle, status: Number(error?.status) || null, error: String(error?.message || error).slice(0, 300) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));
  return output;
}

async function putJson(r2, key, value) {
  await r2.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
}

export async function collectStationheadFollowers(env, scheduledAt = Date.now(), fetchFn = fetch) {
  if (!env?.OTHER_DB?.prepare) throw new Error('OTHER_DB binding is required');
  if (!env?.PAGES_RESPONSE_R2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  const now = Number(scheduledAt) || Date.now();
  const date = jstDateKey(now);
  const targetRows = await env.OTHER_DB.prepare('SELECT handle,source_mask FROM sh_stationhead_follower_targets ORDER BY handle').all();
  const { targets, ignored } = normalizeFollowerTargets(targetRows.results || []);
  const appVersion = String(env?.SH_APP_VERSION || '1.0.0');
  const session = await guestSession(fetchFn, appVersion);
  const collected = await collectProfiles(targets, session, fetchFn, appVersion);
  const failures = collected.filter((row) => !row.ok).map(({ handle, status, error }) => ({ handle, status, error }));
  const fixedFailures = failures.filter((row) => FIXED_FOLLOWER_HANDLES.includes(row.handle));
  const collectedAt = Date.now();
  if (fixedFailures.length) {
    const message = `Stationhead fixed follower targets failed: ${fixedFailures.map((row) => row.handle).join(',')}`;
    await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_daily_follower_failures(observed_date_jst,scheduled_at,failed_at,error,details_json) VALUES(?,?,?,?,?)`)
      .bind(date, now, collectedAt, message, JSON.stringify(fixedFailures)).run();
    throw new Error(message);
  }
  const followers = Object.fromEntries(collected.filter((row) => row.ok).map((row) => [row.handle, row.followers]));
  await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_daily_followers_v2(observed_date_jst,scheduled_at,collected_at,followers_json,failures_json) VALUES(?,?,?,?,?) ON CONFLICT(observed_date_jst) DO UPDATE SET scheduled_at=excluded.scheduled_at,collected_at=excluded.collected_at,followers_json=excluded.followers_json,failures_json=excluded.failures_json`)
    .bind(date, now, collectedAt, JSON.stringify(followers), JSON.stringify(failures)).run();
  const history = await env.OTHER_DB.prepare('SELECT observed_date_jst,followers_json FROM sh_stationhead_daily_followers_v2 ORDER BY observed_date_jst ASC').all();
  const payload = buildFollowerReadModel({ historyRows: history.results || [], targets, latestDate: date, updatedAt: collectedAt, failures });
  await putJson(env.PAGES_RESPONSE_R2, pagesR2ResponseKey('followers'), {
    version: 1,
    updated_at: collectedAt,
    cadence_seconds: CADENCE_SECONDS,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
    },
    body: JSON.stringify(payload),
  });
  return { ok: true, observed_date_jst: date, targets: targets.length, successes: Object.keys(followers).length, failures: failures.length, ignored_targets: ignored, updated_at: collectedAt };
}
