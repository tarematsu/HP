import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { enqueueGeniePublication } from './collect-genie-r2-actions.mjs';
import { parseQqAnimeToplist, qqToplistUrl, QQ_ANIME_TOPLIST_ID, QQ_ANIME_TOPLIST_LIMIT } from '../src/regional-music-qq.js';
import {
  compareQqJapanHistoryPeriods,
  filterQqAnimeSakamichiEntries,
  normalizeQqJapanHistoryPeriod,
  QQ_ANIME_HISTORY_INDEX_KEY,
  QQ_ANIME_HISTORY_PREFIX,
  QQ_ANIME_HISTORY_TARGETS,
  QQ_ANIME_HISTORY_VIEW_KEY,
  qqAnimeHistoryIndex,
  qqAnimeHistoryR2Key,
  qqAnimeHistoryRecord,
  qqAnimeHistoryRows,
  qqAnimeHistorySummary,
  qqAnimeHistoryViewFromRows,
  qqIsoWeekPeriod,
} from '../src/qq-anime-chart-history-view.js';

export {
  compareQqJapanHistoryPeriods,
  filterQqAnimeSakamichiEntries,
  QQ_ANIME_HISTORY_INDEX_KEY,
  QQ_ANIME_HISTORY_PREFIX,
  QQ_ANIME_HISTORY_TARGETS,
  QQ_ANIME_HISTORY_VIEW_KEY,
  qqAnimeHistoryR2Key,
  qqAnimeHistoryRecord,
  qqIsoWeekPeriod,
};

export const QQ_ANIME_HISTORY_PROGRESS_KEY = `${QQ_ANIME_HISTORY_PREFIX}/progress.json`;
export const QQ_ANIME_HISTORY_DEFAULT_START = '2020-06-01';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_DELAY_MS = 300;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_SUSPICIOUS_DUPLICATES = 4;

function latestThursdayJst(now = Date.now()) {
  const jst = new Date(Number(now) + 9 * 60 * 60 * 1000);
  const calendar = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const daysBack = (calendar.getUTCDay() - 4 + 7) % 7;
  calendar.setUTCDate(calendar.getUTCDate() - daysBack);
  return calendar;
}

export function qqAnimeHistoryPeriods(now = Date.now(), startDate = QQ_ANIME_HISTORY_DEFAULT_START) {
  const earliest = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(earliest.getTime())) throw new Error('invalid QQ anime history start date');
  const periods = [];
  const seen = new Set();
  for (let date = latestThursdayJst(now); date.getTime() >= earliest.getTime(); date = new Date(date.getTime() - WEEK_MS)) {
    const period = qqIsoWeekPeriod(date);
    if (!seen.has(period)) {
      seen.add(period);
      periods.push(period);
    }
  }
  return periods;
}

export function qqAnimeHistoryToplistUrl(period) {
  const normalized = normalizeQqJapanHistoryPeriod(period);
  if (!normalized) throw new Error('invalid QQ anime history period');
  return qqToplistUrl(QQ_ANIME_TOPLIST_ID, QQ_ANIME_TOPLIST_LIMIT, normalized);
}

function parseJsonLike(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('empty QQ anime history response');
  try { return JSON.parse(source); } catch {}
  const match = source.match(/^[^(]*\((\{[\s\S]*\}|\[[\s\S]*\])\)\s*;?$/);
  if (!match) throw new Error('invalid QQ anime history JSON/JSONP response');
  return JSON.parse(match[1]);
}

function providerPeriod(payload) {
  const data = payload?.req_1?.data || payload?.detail?.data || payload?.data || {};
  return data?.period || data?.periodName || data?.period_name || data?.periodDetail || null;
}

function chartFingerprint(entries = []) {
  return entries.map((row) => `${row.position}:${row.track_id}`).join('|');
}

export async function fetchQqAnimeHistoryPeriod(period, fetchImpl = fetch) {
  const response = await fetchImpl(qqAnimeHistoryToplistUrl(period), {
    headers:{
      accept:'application/json,text/plain,*/*',
      referer:`https://y.qq.com/n/ryqq/toplist/${QQ_ANIME_TOPLIST_ID}`,
      'user-agent':'Mozilla/5.0 compatible; skrzk-pages-history/1.0',
    },
    signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`QQ anime history HTTP ${response.status}`);
  const payload = parseJsonLike(await response.text());
  if (payload?.code || payload?.req_1?.code) throw new Error('QQ anime history provider error');
  const chart = parseQqAnimeToplist(payload);
  return {
    ...chart,
    requested_period:normalizeQqJapanHistoryPeriod(period),
    provider_period:providerPeriod(payload),
    fingerprint:chartFingerprint(chart.entries),
  };
}

function periodMatchesProvider(period, provider) {
  if (!provider) return null;
  const normalized = normalizeQqJapanHistoryPeriod(provider);
  return normalized ? normalized === normalizeQqJapanHistoryPeriod(period) : null;
}

async function withRetries(task, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try { return await task(attempt); }
    catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

export async function backfillQqAnimeHistory({
  load,
  save,
  periods,
  fetchPeriod = fetchQqAnimeHistoryPeriod,
  now = Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const requestedPeriods = Array.from(periods || []);
  const existingIndex = await load(QQ_ANIME_HISTORY_INDEX_KEY);
  const weeks = { ...(existingIndex?.weeks || {}) };
  const records = new Map();
  let fetched = 0;
  let skipped = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let suspiciousDuplicates = 0;
  let previousRemote = null;

  for (const period of requestedPeriods) {
    const key = qqAnimeHistoryR2Key(period);
    const existing = await load(key);
    if (existing?.version === 1 && existing?.period === normalizeQqJapanHistoryPeriod(period)) {
      weeks[existing.period] = qqAnimeHistorySummary(existing);
      records.set(existing.period, existing);
      skipped += 1;
      continue;
    }

    let chart;
    try {
      chart = await withRetries(() => fetchPeriod(period));
      consecutiveFailures = 0;
    } catch (error) {
      failures += 1;
      consecutiveFailures += 1;
      console.error(JSON.stringify({ event:'qq_anime_history_period_failed', period, error:String(error?.message || error) }));
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`QQ anime history stopped after ${consecutiveFailures} consecutive failures`);
      continue;
    }

    const match = periodMatchesProvider(period, chart.provider_period);
    if (match === false) throw new Error(`QQ anime history period mismatch: requested ${period}, provider returned ${chart.provider_period}`);
    if (!chart.entries?.length) {
      failures += 1;
      console.warn(JSON.stringify({ event:'qq_anime_history_empty', period, provider_period:chart.provider_period ?? null }));
      continue;
    }

    if (previousRemote && chart.provider_period == null
        && chart.update_time === previousRemote.update_time
        && chart.fingerprint === previousRemote.fingerprint) {
      suspiciousDuplicates += 1;
    } else {
      suspiciousDuplicates = 0;
    }
    if (suspiciousDuplicates >= MAX_SUSPICIOUS_DUPLICATES) {
      throw new Error('QQ anime history endpoint appears to ignore requested period; refusing repeated current chart');
    }
    previousRemote = chart;

    const record = qqAnimeHistoryRecord(period, chart, now);
    await save(key, record);
    weeks[record.period] = qqAnimeHistorySummary(record);
    records.set(record.period, record);
    fetched += 1;

    if (fetched % 20 === 0) {
      await save(QQ_ANIME_HISTORY_INDEX_KEY, qqAnimeHistoryIndex(weeks, now, existingIndex || {}));
      await save(QQ_ANIME_HISTORY_PROGRESS_KEY, {
        version:1,
        status:'running',
        updated_at:Date.now(),
        fetched,
        skipped,
        failures,
        last_period:record.period,
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const completedAt = Date.now();
  const index = qqAnimeHistoryIndex(weeks, completedAt, existingIndex || {});
  const historyRows = [...records.values()].flatMap((record) => qqAnimeHistoryRows(record));
  const view = qqAnimeHistoryViewFromRows(index, historyRows, completedAt);
  await save(QQ_ANIME_HISTORY_INDEX_KEY, index);
  await save(QQ_ANIME_HISTORY_VIEW_KEY, view);
  const result = {
    version:1,
    status:'complete',
    updated_at:completedAt,
    requested_periods:requestedPeriods.length,
    stored_periods:Object.keys(weeks).length,
    history_entries:view.history.length,
    fetched,
    skipped,
    failures,
    earliest_period:index.earliest_period,
    latest_period:index.latest_period,
  };
  await save(QQ_ANIME_HISTORY_PROGRESS_KEY, result);
  return result;
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket missing');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Cloudflare account context missing');
  const r2 = createWranglerRemoteR2({
    bucket,
    cwd:root,
    wranglerScript:join(root, 'node_modules/wrangler/bin/wrangler.js'),
  });
  const load = async (key) => {
    const object = await r2.get(key);
    return object ? object.json() : null;
  };
  const save = async (key, value) => {
    await r2.put(key, JSON.stringify(value));
    console.log(JSON.stringify({ event:'qq_anime_history_saved', key, entries:value.entries?.length ?? value.history?.length ?? null }));
  };
  const startDate = process.env.QQ_ANIME_HISTORY_START || QQ_ANIME_HISTORY_DEFAULT_START;
  const periods = qqAnimeHistoryPeriods(Date.now(), startDate);
  const result = await backfillQqAnimeHistory({ load, save, periods });

  const api = async (path, body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
      method:body ? 'POST' : 'GET',
      headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' },
      ...(body ? { body:JSON.stringify(body) } : {}),
      signal:AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) throw new Error(`Publication queue API failed: HTTP ${response.status}`);
    return payload.result;
  };
  await enqueueGeniePublication(config, api, result.updated_at);
  console.log(JSON.stringify({ event:'qq_anime_history_complete', publication_messages:1, ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
