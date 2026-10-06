import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';
const API_BASE = 'https://production1.stationhead.com';
const WEB_BASE = 'https://www.stationhead.com';
const PROFILE_BASE = `${API_BASE}/account/handle/`;
const JST_OFFSET_MS = 9 * 60 * 60_000;
const CADENCE_SECONDS = 24 * 60 * 60;
const SOURCE_FIXED = 1;
const SOURCE_BUDDIES = 2;
const SOURCE_OHISAMA = 4;
const SOURCE_NOGIZAKA = 8;
const HANDLE_RE = /^[a-z0-9._-]{1,64}$/;
const EXCLUDED_HANDLES = new Set(['46fm', 'buddy46']);

export const FIXED_FOLLOWER_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);

function wrangler(args, { capture = true } = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function remoteDatabase() {
  return createWranglerRemoteD1({
    database: databaseName,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.stationhead-followers-actions-',
  });
}

function uploadJson(key, payload) {
  const directory = mkdtempSync(join(workerRoot, '.stationhead-followers-r2-'));
  try {
    const path = join(directory, 'payload.json');
    writeFileSync(path, JSON.stringify(payload), 'utf8');
    wrangler([
      'r2', 'object', 'put', `${responseBucket}/${key}`,
      '--remote', '--file', path,
      '--content-type', 'application/json; charset=utf-8',
    ], { capture: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function normalizeFollowerHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  if (!HANDLE_RE.test(handle) || EXCLUDED_HANDLES.has(handle)) return '';
  return handle;
}

function fixedIndex(handle) {
  const index = FIXED_FOLLOWER_HANDLES.indexOf(handle);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function orderedHandles(values) {
  return [...new Set(values.map(normalizeFollowerHandle).filter(Boolean))].sort((a, b) => {
    const aFixed = fixedIndex(a);
    const bFixed = fixedIndex(b);
    if (aFixed !== bFixed) return aFixed - bFixed;
    return a.localeCompare(b);
  });
}

export function normalizeFollowerTargets(rows = []) {
  const byHandle = new Map(FIXED_FOLLOWER_HANDLES.map((handle) => [handle, SOURCE_FIXED]));
  let ignored = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const handle = normalizeFollowerHandle(row?.handle);
    if (!handle) {
      ignored += 1;
      continue;
    }
    const sourceMask = Math.max(0, Math.trunc(Number(row?.source_mask) || 0));
    byHandle.set(handle, Number(byHandle.get(handle) || 0) | sourceMask);
  }
  const handles = orderedHandles([...byHandle.keys()]);
  return {
    targets: handles.map((handle) => ({ handle, source_mask: Number(byHandle.get(handle) || 0) })),
    ignored,
  };
}

function jstDateKey(timestamp) {
  return new Date(Number(timestamp) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function offsetDateKey(day, offsetDays) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offsetDays * 86_400_000)
    .toISOString().slice(0, 10);
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function membership(handle, sourceMask) {
  if (handle === 'sakurazaka46jp') return { affiliation: '櫻坂46公式', group: 'sakurazaka46' };
  if (handle === 'nogizaka46smej') return { affiliation: '乃木坂46公式', group: 'nogizaka46' };
  if (handle === 'nogifan1ch') return { affiliation: 'Nogizaka', group: 'nogizaka46' };
  if (handle === 'sakuramankai' || handle === 'sakuramankai2') {
    return { affiliation: 'Buddies', group: 'sakurazaka46' };
  }
  if (sourceMask & SOURCE_BUDDIES) return { affiliation: 'Buddies', group: 'sakurazaka46' };
  if (sourceMask & SOURCE_OHISAMA) return { affiliation: 'Ohisama', group: 'hinatazaka46' };
  if (sourceMask & SOURCE_NOGIZAKA) return { affiliation: 'Nogizaka', group: 'nogizaka46' };
  return null;
}

function parsedFollowerJson(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result = {};
    for (const [rawHandle, rawFollowers] of Object.entries(parsed)) {
      const handle = normalizeFollowerHandle(rawHandle);
      const followers = nonNegativeInteger(rawFollowers);
      if (handle && followers != null) result[handle] = followers;
    }
    return result;
  } catch {
    return {};
  }
}

export function buildFollowerReadModel({
  historyRows = [],
  targets = [],
  latestDate,
  updatedAt,
  failures = [],
} = {}) {
  const sourceMasks = new Map();
  for (const target of targets) {
    const handle = normalizeFollowerHandle(target?.handle);
    if (!handle) continue;
    sourceMasks.set(handle, Number(sourceMasks.get(handle) || 0) | Math.max(0, Number(target?.source_mask) || 0));
  }
  for (const handle of FIXED_FOLLOWER_HANDLES) {
    sourceMasks.set(handle, Number(sourceMasks.get(handle) || 0) | SOURCE_FIXED);
  }

  const handles = orderedHandles([...sourceMasks.keys()]);
  const allowedHandles = new Set(handles);
  const normalizedRows = [];
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const date = String(row?.observed_date_jst || row?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const followers = row?.followers_json != null
      ? parsedFollowerJson(row.followers_json)
      : parsedFollowerJson(JSON.stringify(row));
    const filteredFollowers = Object.fromEntries(
      Object.entries(followers).filter(([handle]) => allowedHandles.has(handle)),
    );
    if (!Object.keys(filteredFollowers).length) continue;
    normalizedRows.push({ date, ...filteredFollowers });
  }
  normalizedRows.sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(normalizedRows.map((row) => [row.date, row]));
  const latest = byDate.get(latestDate) || { date: latestDate };
  const previous = byDate.get(offsetDateKey(latestDate, -1));
  const previousWeek = byDate.get(offsetDateKey(latestDate, -7));
  const accounts = handles.map((handle) => {
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
  const memberships = {};
  for (const handle of handles) {
    const value = membership(handle, Number(sourceMasks.get(handle) || 0));
    if (value) memberships[handle] = value;
  }
  return {
    ok: true,
    updated_at: Number(updatedAt),
    latest_date: latestDate,
    handles,
    rows: normalizedRows,
    accounts,
    memberships,
    failures,
  };
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
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
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

export async function createStationheadGuestSession({ fetchFn = fetch, appVersion = '1.0.0' } = {}) {
  const deviceUid = randomUUID();
  const signal = AbortSignal.timeout(10_000);
  const tokenResponse = await checkedFetch(fetchFn, `${API_BASE}/web/token`, {
    method: 'POST',
    headers: { ...browserHeaders(deviceUid, '', appVersion, `${WEB_BASE}/c/ilys`), 'content-type': 'application/json' },
    body: '',
    signal,
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

async function fetchFollowerProfile(handle, session, { fetchFn = fetch, appVersion = '1.0.0' } = {}) {
  const response = await checkedFetch(fetchFn, `${PROFILE_BASE}${encodeURIComponent(handle)}`, {
    headers: browserHeaders(session.deviceUid, session.token, appVersion),
    signal: AbortSignal.timeout(10_000),
  }, `Stationhead profile ${handle}`);
  const payload = await response.json();
  const followers = nonNegativeInteger(payload?.followers);
  if (followers == null) throw new Error(`Stationhead profile ${handle} has no follower count`);
  return { handle, followers };
}

async function collectWithConcurrency(targets, session, options, concurrency = 4) {
  const results = new Array(targets.length);
  let index = 0;
  async function worker() {
    while (index < targets.length) {
      const current = index;
      index += 1;
      const target = targets[current];
      try {
        results[current] = { ok: true, ...(await fetchFollowerProfile(target.handle, session, options)) };
      } catch (error) {
        results[current] = {
          ok: false,
          handle: target.handle,
          status: Number(error?.status) || null,
          error: String(error?.message || error).slice(0, 300),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));
  return results;
}

async function recordFixedFailure(db, date, scheduledAt, failedAt, failures) {
  const failedHandles = failures.map((row) => row.handle).join(',');
  const error = `Stationhead fixed follower targets failed: ${failedHandles}`;
  await db.prepare(`INSERT INTO sh_stationhead_daily_follower_failures(
      observed_date_jst,scheduled_at,failed_at,error,details_json
    ) VALUES(?,?,?,?,?)`)
    .bind(date, scheduledAt, failedAt, error, JSON.stringify(failures)).run();
  return error;
}

export async function collectStationheadFollowersActions({
  db = remoteDatabase(),
  fetchFn = fetch,
  upload = uploadJson,
  now = Date.now(),
  appVersion = process.env.SH_APP_VERSION || '1.0.0',
} = {}) {
  const scheduledAt = Number(now) || Date.now();
  const date = jstDateKey(scheduledAt);
  const targetResult = await db.prepare(`SELECT handle,source_mask
    FROM sh_stationhead_follower_targets ORDER BY handle`).all();
  const { targets, ignored } = normalizeFollowerTargets(targetResult.results || []);
  const session = await createStationheadGuestSession({ fetchFn, appVersion });
  const collected = await collectWithConcurrency(targets, session, { fetchFn, appVersion });
  const failures = collected.filter((row) => !row.ok).map(({ handle, status, error }) => ({ handle, status, error }));
  const fixedFailures = failures.filter((row) => FIXED_FOLLOWER_HANDLES.includes(row.handle));
  const collectedAt = Date.now();
  if (fixedFailures.length) {
    const error = await recordFixedFailure(db, date, scheduledAt, collectedAt, fixedFailures);
    throw new Error(error);
  }

  const followers = Object.fromEntries(collected.filter((row) => row.ok).map((row) => [row.handle, row.followers]));
  await db.prepare(`INSERT INTO sh_stationhead_daily_followers_v2(
      observed_date_jst,scheduled_at,collected_at,followers_json,failures_json
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(observed_date_jst) DO UPDATE SET
      scheduled_at=excluded.scheduled_at,
      collected_at=excluded.collected_at,
      followers_json=excluded.followers_json,
      failures_json=excluded.failures_json`)
    .bind(date, scheduledAt, collectedAt, JSON.stringify(followers), JSON.stringify(failures)).run();

  const history = await db.prepare(`SELECT observed_date_jst,followers_json
    FROM sh_stationhead_daily_followers_v2
    ORDER BY observed_date_jst ASC`).all();
  const payload = buildFollowerReadModel({
    historyRows: history.results || [],
    targets,
    latestDate: date,
    updatedAt: collectedAt,
    failures,
  });
  const body = JSON.stringify(payload);
  upload(pagesR2ResponseKey('followers'), {
    version: 1,
    updated_at: collectedAt,
    cadence_seconds: CADENCE_SECONDS,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
    },
    body,
  });

  return {
    ok: true,
    observed_date_jst: date,
    targets: targets.length,
    successes: Object.keys(followers).length,
    failures: failures.length,
    ignored_targets: ignored,
    updated_at: collectedAt,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await collectStationheadFollowersActions();
  console.log(JSON.stringify(result));
}
