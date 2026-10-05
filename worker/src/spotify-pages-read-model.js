import {
  spotifyArtistChartSql,
  spotifyReadModelAll,
  spotifyTrendSql,
} from '../../site/functions/api/spotify-playcounts.js';
import { spotifyMonthlyListenersSql } from '../../site/functions/api/spotify-monthly-listeners.js';
import { pagesR2ResponseKey, saveMaterializedR2Response } from './pages-response-r2.js';
import { loadSpotifyLatestDetailRows } from './spotify-read-model-detail.js';

export const SPOTIFY_READ_MODEL_KEY = 'spotify-playcounts';
export const SPOTIFY_READ_MODEL_REFRESH_TYPE = 'spotify-read-model-refresh';

const RESPONSE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const MAX_REFRESH_MARKERS = 12;
const RENDERER_REVISION = 'spotify-event-v4';

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function metadataObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function existingRecord(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object) return null;
  try {
    return {
      body: await object.text(),
      metadata: metadataObject(object.customMetadata),
    };
  } catch {
    return null;
  }
}

function recordModel(record) {
  if (typeof record?.body !== 'string') return null;
  try {
    const parsed = JSON.parse(record.body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function groupSnapshotDates(model) {
  return {
    sakurazaka46: model.groups?.sakurazaka46?.snapshot_date ?? null,
    nogizaka46: model.groups?.nogizaka46?.snapshot_date ?? null,
    hinatazaka46: model.groups?.hinatazaka46?.snapshot_date ?? null,
  };
}

function monthlyListenerRevision(monthlyListenerRows) {
  let latestDate = '';
  let latestCollectedAt = 0;
  for (const row of monthlyListenerRows) {
    const date = String(row?.snapshot_date || '');
    const collectedAt = Number(row?.collected_at || 0);
    if (date > latestDate) latestDate = date;
    if (Number.isFinite(collectedAt) && collectedAt > latestCollectedAt) latestCollectedAt = collectedAt;
  }
  return `${latestDate}:${latestCollectedAt}:${monthlyListenerRows.length}`;
}

function refreshMessages(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => value?.body && typeof value.body === 'object' ? value.body : value)
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
}

export function spotifyReadModelRefreshMarker(message = {}) {
  const reason = String(message?.reason || '').trim();
  if (reason === 'playcount-complete') {
    const revision = String(message?.source_revision || '').trim();
    return revision ? `playcount-complete:${revision}` : null;
  }
  if (reason === 'monthly-listeners-complete') {
    const snapshotDate = String(message?.snapshot_date || '').trim();
    const revision = String(message?.source_revision || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) && revision
      ? `monthly-listeners-complete:${snapshotDate}:${revision}`
      : null;
  }
  if (reason === 'artist-chart') {
    const chartDate = String(message?.chart_date || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(chartDate) ? `artist-chart:${chartDate}` : null;
  }
  return null;
}

function recordRefreshMarkers(record) {
  try {
    const values = JSON.parse(record?.metadata?.refresh_markers_json || '[]');
    return Array.isArray(values)
      ? values.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function refreshesCoveredByRecord(record, messages) {
  if (!recordModel(record) || !messages.length) return false;
  const markers = messages.map(spotifyReadModelRefreshMarker);
  if (markers.some((marker) => !marker)) return false;
  const covered = new Set(recordRefreshMarkers(record));
  return markers.every((marker) => covered.has(marker));
}

function mergedRefreshMarkers(previous, messages) {
  const markers = [...recordRefreshMarkers(previous)];
  for (const message of messages) {
    const marker = spotifyReadModelRefreshMarker(message);
    if (!marker) continue;
    const existingIndex = markers.indexOf(marker);
    if (existingIndex >= 0) markers.splice(existingIndex, 1);
    markers.push(marker);
  }
  return markers.slice(-MAX_REFRESH_MARKERS);
}

function readModelResultFromRecord(record, key) {
  const model = recordModel(record);
  if (!model) return null;
  const snapshots = groupSnapshotDates(model);
  const monthlyListenerRows = Array.isArray(model.monthly_listener_rows)
    ? model.monthly_listener_rows
    : [];
  return {
    published: false,
    changed: false,
    skipped_d1: true,
    object_key: key,
    snapshot_date: snapshots.sakurazaka46,
    snapshot_dates: snapshots,
    chart_date: model.artist_chart?.latest_chart_date ?? null,
    monthly_listener_revision: monthlyListenerRevision(monthlyListenerRows),
  };
}

export function spotifyReadModelRefreshMessage(reason, detail = {}) {
  return {
    message_type: SPOTIFY_READ_MODEL_REFRESH_TYPE,
    message_version: 1,
    reason: String(reason || 'spotify-data'),
    ...detail,
  };
}

export async function requestSpotifyReadModelRefresh(env, reason, detail = {}) {
  if (typeof env?.SPOTIFY_PLAYCOUNT_QUEUE?.send !== 'function') return false;
  await env.SPOTIFY_PLAYCOUNT_QUEUE.send(spotifyReadModelRefreshMessage(reason, detail));
  return true;
}

export async function publishSpotifyPagesReadModel(env, options = {}) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is required for Spotify read-model refresh');
  }
  const key = pagesR2ResponseKey(SPOTIFY_READ_MODEL_KEY);
  if (!key) throw new Error('Spotify read-model R2 key is unavailable');

  const messages = refreshMessages(options.refreshMessages);
  const previous = Object.hasOwn(options, 'previousRecord')
    ? options.previousRecord
    : await existingRecord(r2, key);
  if (messages.length && refreshesCoveredByRecord(previous, messages)) {
    return readModelResultFromRecord(previous, key);
  }

  const db = env?.OTHER_DB;
  if (!db?.prepare) throw new Error('OTHER_DB binding is required for Spotify read-model refresh');

  const [latestRows, trendResult, artistChartResult, monthlyListenersResult] = await Promise.all([
    loadSpotifyLatestDetailRows(db),
    db.prepare(spotifyTrendSql()).all(),
    db.prepare(spotifyArtistChartSql()).all(),
    db.prepare(spotifyMonthlyListenersSql()).all(),
  ]);
  const monthlyListenerRows = rows(monthlyListenersResult);
  const model = {
    ...spotifyReadModelAll(latestRows, rows(trendResult), rows(artistChartResult)),
    monthly_listener_rows: monthlyListenerRows,
  };
  const body = JSON.stringify({ ok: true, ...model });

  const snapshots = groupSnapshotDates(model);
  const refreshMarkers = mergedRefreshMarkers(previous, messages);
  const previousMarkers = recordRefreshMarkers(previous);
  const markersChanged = JSON.stringify(refreshMarkers) !== JSON.stringify(previousMarkers);

  if (previous?.body === body && !markersChanged) {
    return {
      published: false,
      changed: false,
      skipped_d1: false,
      object_key: key,
      snapshot_date: snapshots.sakurazaka46,
      snapshot_dates: snapshots,
      chart_date: model.artist_chart?.latest_chart_date ?? null,
      monthly_listener_revision: monthlyListenerRevision(monthlyListenerRows),
    };
  }

  const now = Number(options.now ?? Date.now());
  const sourceRevision = [
    'spotify-event',
    snapshots.sakurazaka46 ?? '',
    snapshots.nogizaka46 ?? '',
    snapshots.hinatazaka46 ?? '',
    model.artist_chart?.latest_chart_date ?? '',
    model.artist_chart?.latest_observed_at ?? '',
    monthlyListenerRevision(monthlyListenerRows),
  ].join(':');
  await saveMaterializedR2Response(
    r2,
    SPOTIFY_READ_MODEL_KEY,
    body,
    200,
    RESPONSE_HEADERS,
    Number.isFinite(now) ? now : Date.now(),
    0,
    {
      source_revision: sourceRevision,
      renderer_revision: RENDERER_REVISION,
      refresh_markers_json: JSON.stringify(refreshMarkers),
    },
  );
  return {
    published: true,
    changed: previous?.body !== body,
    skipped_d1: false,
    object_key: key,
    snapshot_date: snapshots.sakurazaka46,
    snapshot_dates: snapshots,
    chart_date: model.artist_chart?.latest_chart_date ?? null,
    monthly_listener_revision: monthlyListenerRevision(monthlyListenerRows),
  };
}

export async function processSpotifyReadModelRefreshBatch(batch, env) {
  const messages = [...(batch?.messages || [])];
  if (!messages.length) return { processed: 0, failed: 0, ignored: 0 };
  try {
    await publishSpotifyPagesReadModel(env, { refreshMessages: messages });
    for (const message of messages) message.ack?.();
    return { processed: messages.length, failed: 0, ignored: 0 };
  } catch (error) {
    for (const message of messages) message.retry?.();
    if (!messages.every((message) => typeof message.retry === 'function')) throw error;
    return { processed: 0, failed: messages.length, ignored: 0 };
  }
}
