import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { enqueueGeniePublication } from './collect-genie-r2-actions.mjs';
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
} from '../src/kugou-acg-chart-history.js';

export const KUGOU_ACG_HISTORY_DEFAULT_START = '2019-01-01';
const REQUEST_DELAY_MS = 300;
const MAX_CONSECUTIVE_FAILURES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers:{ accept:'application/json,text/plain,*/*', referer:'https://www.kugou.com/', 'user-agent':'Mozilla/5.0 compatible; skrzk-pages-kugou-acg-backfill/1.0' },
    signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Kugou ACG HTTP ${response.status}`);
  const payload = await response.json();
  if (Number(payload?.status) !== 1 || Number(payload?.errcode || 0) !== 0) throw new Error('Kugou ACG provider error');
  return payload;
}

async function withRetries(task, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try { return await task(attempt); }
    catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

export async function fetchKugouAcgVolumes(fetchImpl = fetch) {
  return kugouAcgVolumeList(await fetchJson(kugouAcgVolumeUrl(), fetchImpl));
}

export async function fetchKugouAcgVolume(volume, fetchImpl = fetch) {
  const payload = await fetchJson(kugouAcgSongsUrl(volume.volid), fetchImpl);
  return parseKugouAcgSongs(payload);
}

export async function backfillKugouAcgHistory({
  load,
  save,
  volumes,
  fetchVolume = fetchKugouAcgVolume,
  now = Date.now(),
  pause = sleep,
}) {
  const requested = Array.from(volumes || []);
  const existingIndex = await load(KUGOU_ACG_HISTORY_INDEX_KEY);
  const existingView = await load(KUGOU_ACG_HISTORY_VIEW_KEY);
  const weeks = { ...(existingIndex?.weeks || {}) };
  let history = Array.isArray(existingView?.history) ? [...existingView.history] : [];
  let fetched = 0;
  let skipped = 0;
  let failures = 0;
  let consecutiveFailures = 0;

  for (const volume of requested) {
    const existing = weeks?.[volume.period];
    if (String(existing?.volid || '') === String(volume.volid)) {
      skipped += 1;
      continue;
    }

    let entries;
    try {
      entries = await withRetries(() => fetchVolume(volume));
      consecutiveFailures = 0;
    } catch (error) {
      failures += 1;
      consecutiveFailures += 1;
      console.error(JSON.stringify({ event:'kugou_acg_backfill_volume_failed', period:volume.period, volid:volume.volid, error:String(error?.message || error) }));
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`Kugou ACG backfill stopped after ${consecutiveFailures} consecutive failures`);
      continue;
    }

    const record = kugouAcgHistoryRecord(volume, entries, now);
    await save(kugouAcgHistoryR2Key(record.period), record);
    weeks[record.period] = kugouAcgHistorySummary(record);
    history = history.filter((item) => item?.period !== record.period);
    history.push(...kugouAcgHistoryRows(record));
    fetched += 1;

    if (fetched % 20 === 0) {
      await save(KUGOU_ACG_HISTORY_INDEX_KEY, kugouAcgHistoryIndex(weeks, Date.now(), existingIndex || {}));
      await save(KUGOU_ACG_HISTORY_PROGRESS_KEY, {
        version:1,
        status:'running',
        updated_at:Date.now(),
        requested_volumes:requested.length,
        fetched,
        skipped,
        failures,
        last_period:record.period,
      });
    }
    await pause(REQUEST_DELAY_MS);
  }

  const completedAt = Date.now();
  const index = kugouAcgHistoryIndex(weeks, completedAt, existingIndex || {});
  const view = kugouAcgHistoryViewFromRows(index, history, completedAt);
  await save(KUGOU_ACG_HISTORY_INDEX_KEY, index);
  await save(KUGOU_ACG_HISTORY_VIEW_KEY, view);
  const result = {
    version:1,
    status:'complete',
    updated_at:completedAt,
    requested_volumes:requested.length,
    stored_periods:Object.keys(weeks).length,
    history_entries:view.history.length,
    fetched,
    skipped,
    failures,
    earliest_period:index.earliest_period,
    latest_period:index.latest_period,
  };
  await save(KUGOU_ACG_HISTORY_PROGRESS_KEY, result);
  return result;
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket missing');
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
    console.log(JSON.stringify({ event:'kugou_acg_backfill_saved', key, entries:value.entries?.length ?? value.history?.length ?? null }));
  };

  const startDate = process.env.KUGOU_ACG_HISTORY_START || KUGOU_ACG_HISTORY_DEFAULT_START;
  const volumes = (await fetchKugouAcgVolumes()).filter((volume) => String(volume.published_at || '') >= startDate);
  const result = await backfillKugouAcgHistory({ load, save, volumes });

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
  console.log(JSON.stringify({ event:'kugou_acg_backfill_complete', publication_messages:1, ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
