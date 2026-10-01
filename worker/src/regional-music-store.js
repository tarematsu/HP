export function regionalMusicSnapshotDate(observedAt) {
  const timestamp = Number(observedAt) || Date.now();
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dbOf(env) {
  if (!env?.OTHER_DB?.prepare) throw new Error('OTHER_DB binding is required');
  return env.OTHER_DB;
}

function count(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function positive(value) {
  const n = count(value);
  return n && n > 0 ? n : null;
}

export async function saveRegionalArtist(env, value) {
  const observedAt = Number(value.observed_at) || Date.now();
  const db = dbOf(env);
  await db.prepare(`INSERT INTO regional_music_artist_profiles(
    service,canonical_artist,service_artist_id,display_name,profile_url,first_seen_at,last_seen_at
  ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(service,canonical_artist) DO UPDATE SET
    service_artist_id=excluded.service_artist_id,
    display_name=COALESCE(excluded.display_name,display_name),
    profile_url=COALESCE(excluded.profile_url,profile_url),
    last_seen_at=excluded.last_seen_at`)
    .bind(value.service, value.canonical_artist, value.service_artist_id,
      value.display_name ?? null, value.profile_url ?? null, observedAt, observedAt).run();

  const snapshotDate = value.snapshot_date || regionalMusicSnapshotDate(observedAt);
  await db.prepare(`INSERT INTO regional_music_artist_daily(
    snapshot_date,service,canonical_artist,observed_at,followers,likes
  ) VALUES(?,?,?,?,?,?) ON CONFLICT(snapshot_date,service,canonical_artist) DO UPDATE SET
    observed_at=excluded.observed_at,
    followers=COALESCE(excluded.followers,followers),
    likes=COALESCE(excluded.likes,likes)`)
    .bind(snapshotDate, value.service, value.canonical_artist, observedAt,
      count(value.followers), count(value.likes)).run();
}

export async function saveRegionalTrack(env, value) {
  const observedAt = Number(value.observed_at) || Date.now();
  const db = dbOf(env);
  await db.prepare(`INSERT INTO regional_music_tracks(
    service,service_track_id,service_artist_id,canonical_artist,canonical_track_id,
    title,album_name,track_url,first_seen_at,last_seen_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(service,service_track_id) DO UPDATE SET
    service_artist_id=COALESCE(excluded.service_artist_id,service_artist_id),
    canonical_artist=COALESCE(excluded.canonical_artist,canonical_artist),
    canonical_track_id=COALESCE(excluded.canonical_track_id,canonical_track_id),
    title=COALESCE(excluded.title,title),
    album_name=COALESCE(excluded.album_name,album_name),
    track_url=COALESCE(excluded.track_url,track_url),
    last_seen_at=excluded.last_seen_at`)
    .bind(value.service, value.service_track_id, value.service_artist_id ?? null,
      value.canonical_artist ?? null, positive(value.canonical_track_id), value.title ?? null,
      value.album_name ?? null, value.track_url ?? null, observedAt, observedAt).run();

  const snapshotDate = value.snapshot_date || regionalMusicSnapshotDate(observedAt);
  await db.prepare(`INSERT INTO regional_music_track_daily(
    snapshot_date,service,service_track_id,observed_at,plays,listeners,likes,comments,popularity_rank
  ) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_date,service,service_track_id) DO UPDATE SET
    observed_at=excluded.observed_at,
    plays=COALESCE(excluded.plays,plays),
    listeners=COALESCE(excluded.listeners,listeners),
    likes=COALESCE(excluded.likes,likes),
    comments=COALESCE(excluded.comments,comments),
    popularity_rank=COALESCE(excluded.popularity_rank,popularity_rank)`)
    .bind(snapshotDate, value.service, value.service_track_id, observedAt,
      count(value.plays), count(value.listeners), count(value.likes), count(value.comments),
      positive(value.popularity_rank)).run();
}

export async function saveRegionalCollectorState(env, value) {
  const updatedAt = Number(value.updated_at) || Date.now();
  return dbOf(env).prepare(`INSERT INTO regional_music_collector_state(
    service,status,last_attempt_at,last_success_at,last_error_class,last_error_message,entity_counts_json,updated_at
  ) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(service) DO UPDATE SET
    status=excluded.status,
    last_attempt_at=excluded.last_attempt_at,
    last_success_at=COALESCE(excluded.last_success_at,last_success_at),
    last_error_class=excluded.last_error_class,
    last_error_message=excluded.last_error_message,
    entity_counts_json=excluded.entity_counts_json,
    updated_at=excluded.updated_at`)
    .bind(value.service, value.status, value.last_attempt_at ?? updatedAt,
      value.last_success_at ?? null, value.last_error_class ?? null,
      value.last_error_message ?? null, JSON.stringify(value.entity_counts || {}), updatedAt).run();
}
