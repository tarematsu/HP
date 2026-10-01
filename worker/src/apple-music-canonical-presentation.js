import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import {
  APPLE_MUSIC_ARTIST_ID,
  APPLE_MUSIC_PAGES_MODEL_KEY,
} from './apple-music-collector.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const READ_MODEL_KEY = 'apple-music/read-model/latest.json';
const ARTIST_PREFIX = `apple-music/artist/${APPLE_MUSIC_ARTIST_ID}/`;
const PRESENTATION_VERSION = 1;
const REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object) return null;
  try {
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value, metadata = {}) {
  await r2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: Object.fromEntries(Object.entries(metadata).map(([name, item]) => [name, String(item)])),
  });
}

function flattenRegions(regions) {
  const normalized = Array.isArray(regions) ? regions : [];
  const counts = normalized.map((region) => (Array.isArray(region?.tracks) ? region.tracks.length : 0));
  const tracks = normalized.flatMap((region) => (Array.isArray(region?.tracks) ? region.tracks : []));
  return { normalized, counts, tracks };
}

function rebuiltRegions(regions, counts, tracks) {
  let offset = 0;
  return regions.map((region, index) => {
    const count = counts[index] || 0;
    const next = tracks.slice(offset, offset + count);
    offset += count;
    return { ...region, tracks: next };
  });
}

function presentationTrack(original, canonical) {
  const title = text(canonical?.title) || text(original?.title);
  const artist = text(canonical?.artist) || text(original?.artist);
  if (title === text(original?.title) && artist === text(original?.artist)) return original;
  return {
    ...original,
    title,
    artist,
  };
}

function dueForRefresh(model, now, force) {
  if (force) return true;
  if (Number(model?.canonical_presentation_version) !== PRESENTATION_VERSION) return true;
  const checkedAt = Number(model?.canonical_presentation_checked_at);
  return !Number.isFinite(checkedAt) || checkedAt <= 0 || Number(now) - checkedAt >= REFRESH_INTERVAL_MS;
}

async function publishModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const key = pagesActionsR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  if (!key) throw new Error('Apple Music public read-model key is unavailable');
  const previousEnvelope = await getJson(r2, key);
  const envelope = previousEnvelope && Number(previousEnvelope.version) === 1
    ? {
        ...previousEnvelope,
        updated_at: observedAt,
        source_revision: `apple-music:${model.snapshot_date}:${observedAt}:canonical-${PRESENTATION_VERSION}`,
        body,
      }
    : {
        version: 1,
        status: 200,
        headers: PUBLIC_HEADERS,
        updated_at: observedAt,
        cadence_seconds: 0,
        source_revision: `apple-music:${model.snapshot_date}:${observedAt}:canonical-${PRESENTATION_VERSION}`,
        renderer_revision: 'apple-music-v2',
        body,
      };
  await r2.put(key, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return key;
}

export async function canonicalizeAppleMusicPresentation(
  env,
  now = Date.now(),
  { force = false } = {},
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  const db = env?.MINUTE_DB;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    return { updated: false, presentation_changed: false, reason: 'r2-missing' };
  }
  if (!db?.prepare || typeof db.batch !== 'function') {
    return { updated: false, presentation_changed: false, reason: 'd1-missing' };
  }

  const observedAt = Number(now) || Date.now();
  const model = await getJson(r2, READ_MODEL_KEY);
  if (!model?.regions?.length) {
    return { updated: false, presentation_changed: false, reason: 'model-empty' };
  }
  if (!dueForRefresh(model, observedAt, force)) {
    return { updated: false, presentation_changed: false, reason: 'fresh' };
  }

  const { normalized: regions, counts, tracks } = flattenRegions(model.regions);
  if (!tracks.length) {
    return { updated: false, presentation_changed: false, reason: 'tracks-empty' };
  }

  const canonicalTracks = await canonicalizeTrackRows(db, tracks);
  if (!Array.isArray(canonicalTracks) || canonicalTracks.length !== tracks.length) {
    throw new Error('Apple Music canonical track result length mismatch');
  }

  let presentationChanged = false;
  const presentedTracks = canonicalTracks.map((canonical, index) => {
    const original = tracks[index];
    const presented = presentationTrack(original, canonical);
    if (presented !== original) presentationChanged = true;
    return presented;
  });
  const nextModel = {
    ...model,
    canonical_presentation_version: PRESENTATION_VERSION,
    canonical_presentation_checked_at: observedAt,
    regions: rebuiltRegions(regions, counts, presentedTracks),
  };

  const metadata = {
    snapshotDate: nextModel.snapshot_date || '',
    observedAt,
  };
  await putJson(r2, READ_MODEL_KEY, nextModel, metadata);
  if (nextModel.snapshot_date) {
    await putJson(r2, `${ARTIST_PREFIX}latest.json`, nextModel, metadata);
    await putJson(r2, `${ARTIST_PREFIX}daily/${nextModel.snapshot_date}.json`, nextModel, metadata);
  }
  const publicKey = await publishModel(r2, nextModel, observedAt);

  return {
    updated: true,
    presentation_changed: presentationChanged,
    canonical_presentation_version: PRESENTATION_VERSION,
    regions: regions.length,
    tracks: tracks.length,
    pages_object_key: publicKey,
  };
}
