import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import {
  attachTitleArtistIdentity,
  loadTitleArtistIdentityRows,
} from './track-title-artist-identity.js';
import { APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY } from './apple-music-playlist-collector.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const LATEST_KEY = 'apple-music/playlists/latest.json';
const PRESENTATION_VERSION = 2;
const REFRESH_INTERVAL_MS = 12 * 60 * 60_000;
const LOOKUP_CHUNK_SIZE = 70;
const PRIMARY_ARTIST_KEY = 'sakurazaka46';
const PRIMARY_ARTIST_NAME = '櫻坂46';
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function positiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u00a0]+/gu, '')
    .trim();
}

function artistKey(track) {
  return text(track?.artist_key) || PRIMARY_ARTIST_KEY;
}

function artistName(track) {
  return text(track?.artist_name) || text(track?.artist) || PRIMARY_ARTIST_NAME;
}

function sourceKey(track) {
  const appleId = text(track?.apple_music_id);
  if (appleId) return `apple:${appleId}`;
  const title = normalizedTitle(track?.title);
  return title ? `title:${artistKey(track)}:${title}` : null;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
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

async function loadAppleTrackRefs(db, appleIds) {
  if (!db?.prepare || !appleIds.length) return new Map();
  const result = new Map();
  for (let offset = 0; offset < appleIds.length; offset += LOOKUP_CHUNK_SIZE) {
    const part = appleIds.slice(offset, offset + LOOKUP_CHUNK_SIZE);
    const rows = await db.prepare(`SELECT source_track_id,track_id
      FROM music_service_track_refs
      WHERE service='apple_music' AND source_track_id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all();
    for (const row of rows?.results || []) {
      const appleId = text(row?.source_track_id);
      const trackId = positiveInteger(row?.track_id);
      if (appleId && trackId != null) result.set(appleId, trackId);
    }
  }
  return result;
}

function uniqueSourceTracks(model) {
  const unique = new Map();
  for (const playlist of Array.isArray(model?.playlists) ? model.playlists : []) {
    for (const track of Array.isArray(playlist?.tracks) ? playlist.tracks : []) {
      const key = sourceKey(track);
      if (!key || unique.has(key)) continue;
      unique.set(key, {
        apple_music_id: text(track?.apple_music_id),
        track_id: positiveInteger(track?.track_id),
        title: text(track?.title),
        artist_key: artistKey(track),
        artist_id: text(track?.artist_id),
        artist_name: artistName(track),
        artist: artistName(track),
      });
    }
  }
  return unique;
}

function applyCanonicalTrack(track, canonical) {
  if (!canonical) return track;
  const trackId = positiveInteger(canonical?.track_id) ?? positiveInteger(track?.track_id);
  const title = text(canonical?.title) || text(track?.title) || '曲名不明';
  if (trackId === positiveInteger(track?.track_id) && title === text(track?.title)) return track;
  return {
    ...track,
    track_id: trackId,
    title,
  };
}

function rebuildReverseIndex(playlists) {
  const grouped = new Map();
  for (const playlist of playlists) {
    for (const track of Array.isArray(playlist?.tracks) ? playlist.tracks : []) {
      const trackId = positiveInteger(track?.track_id);
      const appleId = text(track?.apple_music_id);
      const title = text(track?.title) || '曲名不明';
      const key = trackId != null
        ? `track:${trackId}`
        : appleId
          ? `apple:${appleId}`
          : `title:${artistKey(track)}:${normalizedTitle(title)}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          track_id: trackId,
          apple_music_id: appleId,
          title,
          artist_key: artistKey(track),
          artist_id: text(track?.artist_id),
          artist_name: artistName(track),
          playlists: [],
        });
      }
      grouped.get(key).playlists.push({
        id: playlist.id,
        name: playlist.name,
        curator: playlist.curator,
        url: playlist.url,
        position: track.position,
      });
    }
  }
  return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}

function dueForRefresh(model, now, force) {
  if (force) return true;
  if (Number(model?.canonical_presentation_version) !== PRESENTATION_VERSION) return true;
  const checkedAt = Number(model?.canonical_presentation_checked_at);
  return !Number.isFinite(checkedAt) || checkedAt <= 0 || Number(now) - checkedAt >= REFRESH_INTERVAL_MS;
}

async function publishModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const key = pagesActionsR2ResponseKey(APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY);
  if (!key) throw new Error('Apple Music playlist public read-model key is unavailable');
  const previousEnvelope = await getJson(r2, key);
  const sourceRevision = `apple-music-playlists:${model.scan_date}:${observedAt}:canonical-${PRESENTATION_VERSION}`;
  const envelope = previousEnvelope && Number(previousEnvelope.version) === 1
    ? {
        ...previousEnvelope,
        updated_at: observedAt,
        cadence_seconds: 43_200,
        source_revision: sourceRevision,
        renderer_revision: 'apple-music-playlists-v3',
        body,
      }
    : {
        version: 1,
        status: 200,
        headers: PUBLIC_HEADERS,
        updated_at: observedAt,
        cadence_seconds: 43_200,
        source_revision: sourceRevision,
        renderer_revision: 'apple-music-playlists-v3',
        body,
      };
  await r2.put(key, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return key;
}

export async function canonicalizeAppleMusicPlaylistPresentation(
  env,
  now = Date.now(),
  { force = false } = {},
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  const minuteDb = env?.MINUTE_DB;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    return { updated: false, presentation_changed: false, reason: 'r2-missing' };
  }
  if (!minuteDb?.prepare || typeof minuteDb.batch !== 'function') {
    return { updated: false, presentation_changed: false, reason: 'minute-db-missing' };
  }

  const observedAt = Number(now) || Date.now();
  const model = await getJson(r2, LATEST_KEY);
  if (!model?.playlists?.length) {
    return { updated: false, presentation_changed: false, reason: 'model-empty' };
  }
  if (!dueForRefresh(model, observedAt, force)) {
    return { updated: false, presentation_changed: false, reason: 'fresh' };
  }

  const unique = uniqueSourceTracks(model);
  if (!unique.size) {
    return { updated: false, presentation_changed: false, reason: 'tracks-empty' };
  }

  const appleIds = [...new Set([...unique.values()].map((track) => track.apple_music_id).filter(Boolean))];
  const sourceRefs = await loadAppleTrackRefs(env?.OTHER_DB, appleIds);
  let sourceTracks = [...unique.values()].map((track) => ({
    ...track,
    track_id: positiveInteger(track.track_id) ?? sourceRefs.get(track.apple_music_id) ?? null,
  }));

  const titleIdentityRows = await loadTitleArtistIdentityRows(
    minuteDb,
    sourceTracks,
    Math.max(80, sourceTracks.length),
    { canonicalOnly: true },
  );
  sourceTracks = attachTitleArtistIdentity(sourceTracks, titleIdentityRows);
  const canonicalTracks = await canonicalizeTrackRows(minuteDb, sourceTracks);
  if (!Array.isArray(canonicalTracks) || canonicalTracks.length !== sourceTracks.length) {
    throw new Error('Apple Music playlist canonical track result length mismatch');
  }

  const canonicalByKey = new Map();
  [...unique.keys()].forEach((key, index) => canonicalByKey.set(key, canonicalTracks[index]));

  let presentationChanged = false;
  const playlists = model.playlists.map((playlist) => ({
    ...playlist,
    tracks: (Array.isArray(playlist?.tracks) ? playlist.tracks : []).map((track) => {
      const next = applyCanonicalTrack(track, canonicalByKey.get(sourceKey(track)));
      if (next !== track) presentationChanged = true;
      return next;
    }),
  }));
  const tracks = rebuildReverseIndex(playlists);
  if (JSON.stringify(tracks) !== JSON.stringify(model.tracks || [])) presentationChanged = true;

  const nextModel = {
    ...model,
    canonical_presentation_version: PRESENTATION_VERSION,
    canonical_presentation_checked_at: observedAt,
    playlists,
    tracks,
  };
  await putJson(r2, LATEST_KEY, nextModel, {
    scanDate: nextModel.scan_date || '',
    observedAt,
  });
  const publicKey = await publishModel(r2, nextModel, observedAt);

  return {
    updated: true,
    presentation_changed: presentationChanged,
    canonical_presentation_version: PRESENTATION_VERSION,
    playlists: playlists.length,
    tracks: tracks.length,
    source_refs: sourceRefs.size,
    title_identity_rows: titleIdentityRows.length,
    pages_object_key: publicKey,
  };
}
