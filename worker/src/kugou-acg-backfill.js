import {
  KUGOU_ACG_HISTORY_INDEX_KEY,
  KUGOU_ACG_HISTORY_PROGRESS_KEY,
  KUGOU_ACG_HISTORY_VIEW_KEY,
  kugouAcgHistoryIndex,
  kugouAcgHistoryR2Key,
  kugouAcgHistoryRecord,
  kugouAcgHistoryRows,
  kugouAcgHistorySummary,
  kugouAcgHistoryViewFromRows,
  kugouAcgSongsUrl,
  kugouAcgVolumeList,
  kugouAcgVolumeUrl,
  parseKugouAcgSongs,
} from './kugou-acg-chart-history.js';

export const KUGOU_ACG_BACKFILL_DEFAULT_START = '2019-01-01';
export const KUGOU_ACG_BACKFILL_BATCH_SIZE = 4;
export const KUGOU_ACG_BACKFILL_MAX_BATCH_SIZE = 10;

function normalizedStartDate(value) {
  const text = String(value || KUGOU_ACG_BACKFILL_DEFAULT_START).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : KUGOU_ACG_BACKFILL_DEFAULT_START;
}

function normalizedBatchSize(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return KUGOU_ACG_BACKFILL_BATCH_SIZE;
  return Math.min(parsed, KUGOU_ACG_BACKFILL_MAX_BATCH_SIZE);
}

async function loadJson(r2, key) {
  const object = await r2?.get?.(key);
  if (!object) return null;
  try {
    return typeof object.json === 'function' ? await object.json() : JSON.parse(await object.text());
  } catch {
    return null;
  }
}

async function saveJson(r2, key, value) {
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  await r2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://www.kugou.com/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-kugou-acg-backfill/2.0',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Kugou ACG HTTP ${response.status}`);
  const payload = await response.json();
  if (Number(payload?.status) !== 1 || Number(payload?.errcode || 0) !== 0) {
    throw new Error('Kugou ACG provider error');
  }
  return payload;
}

async function fetchVolumes(fetchImpl) {
  return kugouAcgVolumeList(await fetchJson(fetchImpl, kugouAcgVolumeUrl()));
}

async function fetchVolumeEntries(fetchImpl, volume) {
  const payload = await fetchJson(fetchImpl, kugouAcgSongsUrl(volume.volid));
  return parseKugouAcgSongs(payload);
}

export async function runKugouAcgBackfillBatch(
  env,
  options = {},
  fetchImpl = fetch,
) {
  if (!env?.PAGES_RESPONSE_R2) throw new Error('PAGES_RESPONSE_R2 binding is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const startDate = normalizedStartDate(options.startDate ?? options.start_date);
  const batchSize = normalizedBatchSize(options.batchSize ?? options.batch_size);
  const now = Number(options.now) || Date.now();
  const allVolumes = (await fetchVolumes(fetchImpl))
    .filter((volume) => String(volume?.published_at || '') >= startDate);

  const existingIndex = await loadJson(env.PAGES_RESPONSE_R2, KUGOU_ACG_HISTORY_INDEX_KEY);
  const existingView = await loadJson(env.PAGES_RESPONSE_R2, KUGOU_ACG_HISTORY_VIEW_KEY);
  const weeks = { ...(existingIndex?.weeks || {}) };
  let history = Array.isArray(existingView?.history) ? [...existingView.history] : [];

  const missing = allVolumes.filter((volume) => {
    const stored = weeks[volume.period];
    return String(stored?.volid || '') !== String(volume.volid);
  });
  const batch = missing.slice(0, batchSize);

  for (const volume of batch) {
    const entries = await fetchVolumeEntries(fetchImpl, volume);
    const record = kugouAcgHistoryRecord(volume, entries, now);
    await saveJson(env.PAGES_RESPONSE_R2, kugouAcgHistoryR2Key(record.period), record);
    weeks[record.period] = kugouAcgHistorySummary(record);
    history = history.filter((row) => row?.period !== record.period);
    history.push(...kugouAcgHistoryRows(record));
  }

  const completedAt = Date.now();
  const index = kugouAcgHistoryIndex(weeks, completedAt, existingIndex || {});
  const view = kugouAcgHistoryViewFromRows(index, history, completedAt);
  await saveJson(env.PAGES_RESPONSE_R2, KUGOU_ACG_HISTORY_INDEX_KEY, index);
  await saveJson(env.PAGES_RESPONSE_R2, KUGOU_ACG_HISTORY_VIEW_KEY, view);

  const remaining = Math.max(0, missing.length - batch.length);
  const result = {
    version: 1,
    status: remaining === 0 ? 'complete' : 'running',
    complete: remaining === 0,
    updated_at: completedAt,
    start_date: startDate,
    requested_volumes: allVolumes.length,
    stored_periods: Object.keys(weeks).length,
    history_entries: view.history.length,
    fetched_this_batch: batch.length,
    remaining,
    earliest_period: index.earliest_period,
    latest_period: index.latest_period,
  };
  await saveJson(env.PAGES_RESPONSE_R2, KUGOU_ACG_HISTORY_PROGRESS_KEY, result);
  return result;
}
