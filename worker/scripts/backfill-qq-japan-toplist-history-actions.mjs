import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { parseQqJapanToplist, QQ_JAPAN_TOPLIST_ID, QQ_JAPAN_TOPLIST_LIMIT } from '../src/regional-music-qq.js';

export const QQ_JAPAN_HISTORY_PREFIX = 'regional-music/qq_music/japan-toplist-history';
export const QQ_JAPAN_HISTORY_INDEX_KEY = `${QQ_JAPAN_HISTORY_PREFIX}/index.json`;
export const QQ_JAPAN_HISTORY_PROGRESS_KEY = `${QQ_JAPAN_HISTORY_PREFIX}/progress.json`;
export const QQ_JAPAN_HISTORY_DEFAULT_START = '2018-01-01';
export const QQ_JAPAN_HISTORY_TARGETS = Object.freeze([
  'sakurazaka46',
  'nogizaka46',
  'hinatazaka46',
]);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_DELAY_MS = 300;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_SUSPICIOUS_DUPLICATES = 4;

function normalizePeriod(value) {
  const match = String(value || '').match(/(\d{4})\D+(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}_${Number(match[2])}`;
}

export function compareQqJapanHistoryPeriods(left, right) {
  const a = normalizePeriod(left);
  const b = normalizePeriod(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  const [aYear, aWeek] = a.split('_').map(Number);
  const [bYear, bWeek] = b.split('_').map(Number);
  return (aYear - bYear) || (aWeek - bWeek);
}

export function qqIsoWeekPeriod(dateLike) {
  const input = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(input.getTime())) throw new Error('invalid QQ history date');
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4Weekday + 3);
  const week = 1 + Math.round((date.getTime() - jan4.getTime()) / WEEK_MS);
  return `${isoYear}_${week}`;
}

function latestThursdayJst(now = Date.now()) {
  const jst = new Date(Number(now) + 9 * 60 * 60 * 1000);
  const calendar = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const daysBack = (calendar.getUTCDay() - 4 + 7) % 7;
  calendar.setUTCDate(calendar.getUTCDate() - daysBack);
  return calendar;
}

export function qqJapanHistoryPeriods(now = Date.now(), startDate = QQ_JAPAN_HISTORY_DEFAULT_START) {
  const earliest = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(earliest.getTime())) throw new Error('invalid QQ history start date');
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

export function qqJapanHistoryR2Key(period) {
  const normalized = normalizePeriod(period);
  if (!normalized) throw new Error('invalid QQ history period');
  return `${QQ_JAPAN_HISTORY_PREFIX}/weeks/${normalized}.json`;
}

export function qqJapanHistoryToplistUrl(period) {
  const normalized = normalizePeriod(period);
  if (!normalized) throw new Error('invalid QQ history period');
  const data = { comm: { ct:24, cv:0 }, req_1: {
    module:'musicToplist.ToplistInfoServer',
    method:'GetDetail',
    param:{ topId:QQ_JAPAN_TOPLIST_ID, offset:0, num:QQ_JAPAN_TOPLIST_LIMIT, period:normalized },
  } };
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({g_tk:'5381',format:'json',data:JSON.stringify(data)})}`;
}

function parseJsonLike(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('empty QQ history response');
  try { return JSON.parse(source); } catch {}
  const match = source.match(/^[^(]*\((\{[\s\S]*\}|\[[\s\S]*\])\)\s*;?$/);
  if (!match) throw new Error('invalid QQ history JSON/JSONP response');
  return JSON.parse(match[1]);
}

function providerPeriod(payload) {
  const data = payload?.req_1?.data || payload?.detail?.data || payload?.data || {};
  return data?.period || data?.periodName || data?.period_name || data?.periodDetail || null;
}

function chartFingerprint(entries = []) {
  return entries.map((row) => `${row.position}:${row.track_id}`).join('|');
}

export async function fetchQqJapanHistoryPeriod(period, fetchImpl = fetch) {
  const response = await fetchImpl(qqJapanHistoryToplistUrl(period), {
    headers:{
      accept:'application/json,text/plain,*/*',
      referer:`https://y.qq.com/n/ryqq/toplist/${QQ_JAPAN_TOPLIST_ID}`,
      'user-agent':'Mozilla/5.0 compatible; skrzk-pages-history/1.0',
    },
    signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`QQ history HTTP ${response.status}`);
  const payload = parseJsonLike(await response.text());
  if (payload?.code || payload?.req_1?.code) throw new Error('QQ history provider error');
  const chart = parseQqJapanToplist(payload);
  return {
    ...chart,
    requested_period:normalizePeriod(period),
    provider_period:providerPeriod(payload),
    fingerprint:chartFingerprint(chart.entries),
  };
}

export function filterQqJapanSakamichiEntries(entries = []) {
  return entries
    .filter((row) => QQ_JAPAN_HISTORY_TARGETS.includes(row.canonical_artist))
    .map((row) => ({
      position:row.position,
      track_id:row.track_id,
      title:row.title ?? null,
      album_name:row.album_name ?? null,
      canonical_artist:row.canonical_artist,
      artists:(row.artists || []).map((artist) => ({ mid:artist.mid ?? null, name:artist.name ?? '' })),
    }));
}

function countTargets(entries) {
  return Object.fromEntries(QQ_JAPAN_HISTORY_TARGETS.map((artist) => [artist,
    entries.filter((row) => row.canonical_artist === artist).length]));
}

export function qqJapanHistoryRecord(period, chart, collectedAt = Date.now()) {
  const entries = filterQqJapanSakamichiEntries(chart?.entries || []);
  return {
    version:1,
    service:'qq_music',
    chart:'japan_toplist',
    top_id:QQ_JAPAN_TOPLIST_ID,
    period:normalizePeriod(period),
    provider_period:chart?.provider_period ?? null,
    update_time:chart?.update_time ?? null,
    collected_at:Number(collectedAt),
    source_url:`https://y.qq.com/n/ryqq/toplist/${QQ_JAPAN_TOPLIST_ID}`,
    counts:countTargets(entries),
    entries,
  };
}

function summaryFromRecord(record) {
  return {
    period:record.period,
    provider_period:record.provider_period ?? null,
    update_time:record.update_time ?? null,
    collected_at:record.collected_at,
    counts:record.counts,
    entries:record.entries.length,
  };
}

function periodMatchesProvider(period, provider) {
  if (!provider) return null;
  const normalized = normalizePeriod(provider);
  return normalized ? normalized === normalizePeriod(period) : null;
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

export async function backfillQqJapanHistory({
  load,
  save,
  periods,
  fetchPeriod = fetchQqJapanHistoryPeriod,
  now = Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const requestedPeriods = Array.from(periods || []);
  const existingIndex = await load(QQ_JAPAN_HISTORY_INDEX_KEY);
  const weeks = { ...(existingIndex?.weeks || {}) };
  let fetched = 0;
  let skipped = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let suspiciousDuplicates = 0;
  let previousRemote = null;

  for (const period of requestedPeriods) {
    const key = qqJapanHistoryR2Key(period);
    const existing = await load(key);
    if (existing?.version === 1 && existing?.period === normalizePeriod(period)) {
      weeks[existing.period] = summaryFromRecord(existing);
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
      console.error(JSON.stringify({ event:'qq_japan_history_period_failed', period, error:String(error?.message || error) }));
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`QQ history stopped after ${consecutiveFailures} consecutive failures`);
      continue;
    }

    const match = periodMatchesProvider(period, chart.provider_period);
    if (match === false) {
      throw new Error(`QQ history period mismatch: requested ${period}, provider returned ${chart.provider_period}`);
    }
    if (!chart.entries?.length) {
      failures += 1;
      console.warn(JSON.stringify({ event:'qq_japan_history_empty', period, provider_period:chart.provider_period ?? null }));
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
      throw new Error('QQ history endpoint appears to ignore requested period; refusing to store repeated current chart');
    }
    previousRemote = chart;

    const record = qqJapanHistoryRecord(period, chart, now);
    await save(key, record);
    weeks[record.period] = summaryFromRecord(record);
    fetched += 1;

    if (fetched % 20 === 0) {
      await save(QQ_JAPAN_HISTORY_INDEX_KEY, {
        version:1,
        service:'qq_music',
        chart:'japan_toplist',
        updated_at:now,
        weeks,
      });
      await save(QQ_JAPAN_HISTORY_PROGRESS_KEY, {
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

  const sortedPeriods = Object.keys(weeks).sort(compareQqJapanHistoryPeriods);
  const index = {
    version:1,
    service:'qq_music',
    chart:'japan_toplist',
    updated_at:Date.now(),
    earliest_period:sortedPeriods[0] || null,
    latest_period:sortedPeriods.at(-1) || null,
    weeks,
  };
  await save(QQ_JAPAN_HISTORY_INDEX_KEY, index);
  const result = {
    version:1,
    status:'complete',
    updated_at:Date.now(),
    requested_periods:requestedPeriods.length,
    stored_periods:Object.keys(weeks).length,
    fetched,
    skipped,
    failures,
    earliest_period:index.earliest_period,
    latest_period:index.latest_period,
  };
  await save(QQ_JAPAN_HISTORY_PROGRESS_KEY, result);
  return result;
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket missing');
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare account context missing');
  }
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
    console.log(JSON.stringify({ event:'qq_japan_history_saved', key, entries:value.entries?.length ?? null }));
  };
  const startDate = process.env.QQ_JAPAN_HISTORY_START || QQ_JAPAN_HISTORY_DEFAULT_START;
  const periods = qqJapanHistoryPeriods(Date.now(), startDate);
  const result = await backfillQqJapanHistory({ load, save, periods });
  console.log(JSON.stringify({ event:'qq_japan_history_complete', ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
