import { saveMaterializedR2Response } from './pages-response-r2.js';
import { regionalMusicService } from './regional-music-service-registry.js';

export const REGIONAL_MUSIC_READ_MODEL_KEY = 'regional-music';
export const REGIONAL_MUSIC_READ_MODEL_CADENCE_SECONDS = 24 * 60 * 60;

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
});

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function all(db, sql) {
  const result = await db.prepare(sql).all();
  return rows(result);
}

export async function loadRegionalMusicReadModel(db) {
  if (typeof db?.prepare !== 'function') throw new Error('OTHER_DB binding is unavailable');

  const [artists, tracks, playlists, memberships, services] = await Promise.all([
    all(db, `SELECT
        p.service,p.canonical_artist,p.service_artist_id,p.display_name,p.profile_url,
        d.snapshot_date,d.observed_at,d.followers,d.likes
      FROM regional_music_artist_profiles AS p
      LEFT JOIN regional_music_artist_daily AS d
        ON d.service=p.service
       AND d.canonical_artist=p.canonical_artist
       AND d.snapshot_date=(
         SELECT MAX(x.snapshot_date)
         FROM regional_music_artist_daily AS x
         WHERE x.service=p.service AND x.canonical_artist=p.canonical_artist
       )
      ORDER BY p.service,p.canonical_artist`),
    all(db, `SELECT
        t.service,t.service_track_id,t.service_artist_id,t.canonical_artist,t.canonical_track_id,
        t.title,t.album_name,t.track_url,
        d.snapshot_date,d.observed_at,d.plays,d.listeners,d.likes,d.comments,d.popularity_rank
      FROM regional_music_tracks AS t
      LEFT JOIN regional_music_track_daily AS d
        ON d.service=t.service
       AND d.service_track_id=t.service_track_id
       AND d.snapshot_date=(
         SELECT MAX(x.snapshot_date)
         FROM regional_music_track_daily AS x
         WHERE x.service=t.service AND x.service_track_id=t.service_track_id
       )
      ORDER BY t.service,t.canonical_artist,t.title,t.service_track_id
      LIMIT 5000`),
    all(db, `SELECT
        service,service_playlist_id,playlist_name,playlist_url,playlist_type,owner_name,last_seen_at
      FROM regional_music_playlists
      ORDER BY service,playlist_name,service_playlist_id
      LIMIT 2000`),
    all(db, `SELECT
        m.service,m.service_playlist_id,m.service_track_id,m.snapshot_date,m.observed_at,m.position
      FROM regional_music_playlist_memberships AS m
      INNER JOIN regional_music_playlist_snapshots AS s
        ON s.service=m.service
       AND s.service_playlist_id=m.service_playlist_id
       AND s.snapshot_date=m.snapshot_date
      WHERE s.snapshot_date=(
        SELECT MAX(x.snapshot_date)
        FROM regional_music_playlist_snapshots AS x
        WHERE x.service=s.service
          AND x.service_playlist_id=s.service_playlist_id
      )
      ORDER BY m.service,m.service_playlist_id,m.position,m.service_track_id
      LIMIT 10000`),
    all(db, `SELECT
        service,status,last_attempt_at,last_success_at,last_error_class,last_error_message,
        entity_counts_json,updated_at
      FROM regional_music_collector_state
      ORDER BY service`),
  ]);

  return { artists, tracks, playlists, memberships, services };
}

function normalizedCollectorState(row) {
  let entityCounts = {};
  try {
    const parsed = JSON.parse(String(row?.entity_counts_json || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entityCounts = parsed;
  } catch {
    entityCounts = {};
  }
  const service = row?.service ?? null;
  const definition = regionalMusicService(service);
  return {
    service,
    region: definition?.region ?? null,
    phase: definition?.phase ?? null,
    metrics: definition ? [...definition.metrics] : [],
    status: row?.status ?? 'pending',
    last_attempt_at: row?.last_attempt_at ?? null,
    last_success_at: row?.last_success_at ?? null,
    last_error_class: row?.last_error_class ?? null,
    last_error_message: row?.last_error_message ?? null,
    entity_counts: entityCounts,
    updated_at: row?.updated_at ?? null,
  };
}

export function regionalMusicReadModelPayload(snapshot, updatedAt = Date.now()) {
  return {
    ok: true,
    updated_at: Number(updatedAt) || Date.now(),
    artists: Array.isArray(snapshot?.artists) ? snapshot.artists : [],
    tracks: Array.isArray(snapshot?.tracks) ? snapshot.tracks : [],
    playlists: Array.isArray(snapshot?.playlists) ? snapshot.playlists : [],
    playlist_memberships: Array.isArray(snapshot?.memberships) ? snapshot.memberships : [],
    services: (Array.isArray(snapshot?.services) ? snapshot.services : []).map(normalizedCollectorState),
  };
}

export async function publishRegionalMusicReadModel(env, updatedAt = Date.now(), dependencies = {}) {
  if (typeof env?.PAGES_RESPONSE_R2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is unavailable');
  }
  const load = dependencies.loadReadModel || loadRegionalMusicReadModel;
  const save = dependencies.saveR2Response || saveMaterializedR2Response;
  const snapshot = await load(env?.OTHER_DB);
  const payload = regionalMusicReadModelPayload(snapshot, updatedAt);
  const body = JSON.stringify(payload);
  const saved = await save(
    env.PAGES_RESPONSE_R2,
    REGIONAL_MUSIC_READ_MODEL_KEY,
    body,
    200,
    JSON_HEADERS,
    updatedAt,
    REGIONAL_MUSIC_READ_MODEL_CADENCE_SECONDS,
  );
  if (!saved) throw new Error('regional music R2 read model write failed');
  return {
    ...saved,
    artists: payload.artists.length,
    tracks: payload.tracks.length,
    playlists: payload.playlists.length,
    playlist_memberships: payload.playlist_memberships.length,
    services: payload.services.length,
  };
}
