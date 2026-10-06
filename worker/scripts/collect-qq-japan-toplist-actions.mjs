import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { enqueueRegionalPublication } from './regional-publication-actions.mjs';
import {
  fetchQqJapanToplist,
  QQ_JAPAN_TOPLIST_PLAYLIST_ID,
  saveQqJapanToplist,
} from '../src/regional-music-qq.js';
import {
  collectRegionalR2Snapshot,
  regionalDayKey,
  regionalSnapshotFromPayload,
  regionalSnapshotKey,
} from '../src/regional-music-r2-snapshot.js';
import { saveRegionalCollectorState } from '../src/regional-music-store.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import {
  qqIsoWeekPeriod,
  qqJapanHistoryRecord,
  upsertQqJapanHistoryArtifacts,
} from '../src/qq-japan-chart-history-view.js';

export const QQ_JAPAN_TOPLIST_MARKER_KEY = 'regional-music/qq_music/japan-toplist-update.json';

export function qqJapanToplistCycleKey(timestamp = Date.now()) {
  const value = Number(timestamp);
  const time = Number.isFinite(value) ? value : Date.now();
  const jst = new Date(time + 9 * 60 * 60 * 1000);
  let daysSinceThursday = (jst.getUTCDay() - 4 + 7) % 7;
  if (daysSinceThursday === 0 && jst.getUTCHours() < 18) daysSinceThursday = 7;
  const cycle = new Date(Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate() - daysSinceThursday,
  ));
  return cycle.toISOString().slice(0, 10);
}

export function qqJapanToplistFingerprint(entries = []) {
  return [...entries]
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || String(a.track_id).localeCompare(String(b.track_id)))
    .map((row) => `${row.position ?? ''}:${row.track_id ?? ''}`)
    .join('|');
}

export function qqJapanToplistPreviousState(snapshot) {
  const playlist = (snapshot?.playlists || []).find((row) =>
    row.service_playlist_id === QQ_JAPAN_TOPLIST_PLAYLIST_ID);
  const memberships = (snapshot?.playlist_memberships || [])
    .filter((row) => row.service_playlist_id === QQ_JAPAN_TOPLIST_PLAYLIST_ID)
    .map((row) => ({ track_id:row.service_track_id, position:row.position }));
  return {
    provider_update_time: playlist?.provider_update_time ?? null,
    fingerprint: qqJapanToplistFingerprint(memberships),
  };
}

export function qqJapanToplistHasUpdated(previous, chart) {
  const before = previous || { provider_update_time:null, fingerprint:'' };
  const afterFingerprint = qqJapanToplistFingerprint(chart?.entries || []);
  if (!before.provider_update_time && !before.fingerprint) return true;
  if (chart?.update_time && before.provider_update_time && chart.update_time !== before.provider_update_time) return true;
  return Boolean(afterFingerprint) && afterFingerprint !== before.fingerprint;
}

function markWorkflowCycle(status) {
  const file = process.env.QQ_JAPAN_TOPLIST_STATUS_FILE;
  if (!file || !['updated','already_updated'].includes(status)) return;
  writeFileSync(file, `${status}\n`, 'utf8');
}

function markerResult(status, marker) {
  return {
    status,
    cycle:marker.cycle,
    provider_update_time:marker.provider_update_time ?? null,
    fingerprint:marker.fingerprint ?? '',
    entries:marker.entries ?? null,
    collected_at:marker.collected_at ?? null,
  };
}

export async function collectQqJapanToplistAttempt({
  load,
  save,
  now = Date.now(),
  fetchImpl = fetch,
  fetchChart = fetchQqJapanToplist,
  bindings = {},
}) {
  const cycle = qqJapanToplistCycleKey(now);
  const marker = await load(QQ_JAPAN_TOPLIST_MARKER_KEY);
  if (marker?.version === 1 && marker.cycle === cycle) {
    if (marker.status === 'updated') return markerResult('already_updated', marker);
    if (marker.status === 'collected') return markerResult('needs_publication', marker);
  }

  const previous = await load(regionalSnapshotKey('qq_music'));
  const before = qqJapanToplistPreviousState(previous);
  const chart = await fetchChart(fetchImpl);
  const fingerprint = qqJapanToplistFingerprint(chart.entries);

  if (!qqJapanToplistHasUpdated(before, chart)) {
    return {
      status:'not_updated',
      cycle,
      provider_update_time:chart.update_time ?? null,
      entries:chart.entries.length,
    };
  }

  const collect = async (env) => {
    await saveQqJapanToplist(env, chart, now);
    await saveRegionalCollectorState(env, {
      service:'qq_music',
      status:'ok',
      last_attempt_at:now,
      last_success_at:now,
      last_error_class:null,
      last_error_message:null,
      entity_counts:{ japan_chart_entries:chart.entries.length },
      updated_at:now,
    });
  };
  const snapshot = await collectRegionalR2Snapshot({
    service:'qq_music',
    collect,
    previous,
    now,
    fetchImpl,
    bindings,
  });
  if (snapshot.state?.status !== 'ok') {
    throw new Error(snapshot.state?.last_error_message || 'QQ Japan toplist snapshot failed');
  }

  await save(regionalDayKey('qq_music', snapshot.day), snapshot);
  await save(regionalSnapshotKey('qq_music'), snapshot);
  const historyPeriod = qqIsoWeekPeriod(new Date(`${cycle}T00:00:00Z`));
  const historyRecord = qqJapanHistoryRecord(historyPeriod, {
    ...chart,
    provider_period:historyPeriod,
  }, now);
  await upsertQqJapanHistoryArtifacts({ load, save, record:historyRecord, updatedAt:now });

  const collectedMarker = {
    version:1,
    cycle,
    status:'collected',
    provider_update_time:chart.update_time ?? null,
    fingerprint,
    entries:chart.entries.length,
    collected_at:now,
  };
  await save(QQ_JAPAN_TOPLIST_MARKER_KEY, collectedMarker);

  return markerResult('collected', collectedMarker);
}

export async function finalizeQqJapanToplistCycle({ save, result, publishedAt = Date.now() }) {
  if (!['collected','needs_publication'].includes(result?.status)) return result;
  const marker = {
    version:1,
    cycle:result.cycle,
    status:'updated',
    provider_update_time:result.provider_update_time ?? null,
    fingerprint:result.fingerprint ?? '',
    entries:result.entries ?? null,
    collected_at:result.collected_at ?? null,
    published_at:publishedAt,
  };
  await save(QQ_JAPAN_TOPLIST_MARKER_KEY, marker);
  return markerResult('updated', marker);
}

async function main() {
  if (process.argv.includes('--cycle-only')) {
    console.log(qqJapanToplistCycleKey(Date.now()));
    return;
  }

  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const minuteDatabase = config.d1_databases.find((row) => row.binding === 'MINUTE_DB')?.database_name;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Cloudflare account context missing');
  if (!minuteDatabase) throw new Error('MINUTE_DB configuration missing');

  const wranglerScript = join(root, 'node_modules/wrangler/bin/wrangler.js');
  const r2 = createWranglerRemoteR2({
    bucket,
    cwd:root,
    wranglerScript,
  });
  const minuteDb = createWranglerRemoteD1({
    database:minuteDatabase,
    cwd:root,
    wranglerScript,
  });
  const published = await r2.get(pagesR2ResponseKey('regional-music'));
  const envelope = published ? await published.json() : null;
  const legacy = envelope?.body ? JSON.parse(envelope.body) : null;
  const load = async (key) => {
    const object = await r2.get(key);
    if (object) return object.json();
    const service = key.match(/^regional-music\/([a-z_]+)\/latest\.json$/)?.[1];
    return service && legacy ? regionalSnapshotFromPayload(legacy, service) : null;
  };
  const save = async (key, value) => {
    await r2.put(key, JSON.stringify(value));
    console.log(JSON.stringify({
      event:'qq_japan_toplist_r2_saved',
      key,
      tracks:value.tracks?.length,
      status:value.state?.status || value.status,
    }));
  };

  let result = await collectQqJapanToplistAttempt({ load, save, bindings:{ MINUTE_DB:minuteDb } });

  if (['collected','needs_publication'].includes(result.status)) {
    const api = async (path, body) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
        method:body ? 'POST' : 'GET',
        headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' },
        ...(body ? { body:JSON.stringify(body) } : {}),
        signal:AbortSignal.timeout(30_000),
      });
      const payload = await response.json();
      if (!response.ok || payload.success !== true) throw new Error(`Publication API failed: HTTP ${response.status}`);
      return payload.result;
    };
    await enqueueRegionalPublication(config, api, Date.now());
    result = await finalizeQqJapanToplistCycle({ save, result });
  }

  markWorkflowCycle(result.status);
  console.log(JSON.stringify({ event:'qq_japan_toplist_attempt', ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
