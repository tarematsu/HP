import { resolveRegionalMusicCanonicalTrack } from './regional-music-track-canonical.js';

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

function canonicalTrackId(value) {
  return positive(value?.track_id ?? value?.canonical_track_id);
}

export async function saveRegionalArtist(env, value) {
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('artists',value);
  const observedAt = Number(value.observed_at) || Date.now();
  const db = dbOf(env);
  await db.prepare(`INSERT INTO regional_music_artist_profiles(
    service,canonical_artist,service_artist_id,display_name,profile_url,first_seen_at,last_seen_at
  ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(service,canonical_artist) DO UPDATE SET
    service_artist_id=excluded.service_artist_id,
    display_name=COALESCE(excluded.display_name,display_name),
    profile_url=COALESCE(excluded.profile_url,profile_url),
    last_seen_at=excluded.last_seen_at
  WHERE (excluded.service_artist_id) IS NOT regional_music_artist_profiles.service_artist_id
    OR (COALESCE(excluded.display_name,display_name)) IS NOT regional_music_artist_profiles.display_name
    OR (COALESCE(excluded.profile_url,profile_url)) IS NOT regional_music_artist_profiles.profile_url
    OR (excluded.last_seen_at) IS NOT regional_music_artist_profiles.last_seen_at`)
    .bind(value.service, value.canonical_artist, value.service_artist_id,
      value.display_name ?? null, value.profile_url ?? null, observedAt, observedAt).run();

  const snapshotDate = value.snapshot_date || regionalMusicSnapshotDate(observedAt);
  await db.prepare(`INSERT INTO regional_music_artist_daily(
    snapshot_date,service,canonical_artist,observed_at,followers,likes,monthly_audience,total_views
  ) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_date,service,canonical_artist) DO UPDATE SET
    observed_at=excluded.observed_at,
    followers=COALESCE(excluded.followers,followers),
    likes=COALESCE(excluded.likes,likes),
    monthly_audience=COALESCE(excluded.monthly_audience,monthly_audience),
    total_views=COALESCE(excluded.total_views,total_views)
  WHERE (excluded.observed_at) IS NOT regional_music_artist_daily.observed_at
    OR (COALESCE(excluded.followers,followers)) IS NOT regional_music_artist_daily.followers
    OR (COALESCE(excluded.likes,likes)) IS NOT regional_music_artist_daily.likes
    OR (COALESCE(excluded.monthly_audience,monthly_audience)) IS NOT regional_music_artist_daily.monthly_audience
    OR (COALESCE(excluded.total_views,total_views)) IS NOT regional_music_artist_daily.total_views`)
    .bind(snapshotDate, value.service, value.canonical_artist, observedAt,
      count(value.followers), count(value.likes), count(value.monthly_audience), count(value.total_views)).run();
}

export async function saveRegionalTrack(env, value) {
  value = await resolveRegionalMusicCanonicalTrack(env, value);
  const trackId = canonicalTrackId(value);
  value = trackId == null ? value : { ...value, track_id: trackId, canonical_track_id: trackId };
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('tracks',value);
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
    last_seen_at=excluded.last_seen_at
  WHERE (COALESCE(excluded.service_artist_id,service_artist_id)) IS NOT regional_music_tracks.service_artist_id
    OR (COALESCE(excluded.canonical_artist,canonical_artist)) IS NOT regional_music_tracks.canonical_artist
    OR (COALESCE(excluded.canonical_track_id,canonical_track_id)) IS NOT regional_music_tracks.canonical_track_id
    OR (COALESCE(excluded.title,title)) IS NOT regional_music_tracks.title
    OR (COALESCE(excluded.album_name,album_name)) IS NOT regional_music_tracks.album_name
    OR (COALESCE(excluded.track_url,track_url)) IS NOT regional_music_tracks.track_url
    OR (excluded.last_seen_at) IS NOT regional_music_tracks.last_seen_at`)
    .bind(value.service, value.service_track_id, value.service_artist_id ?? null,
      value.canonical_artist ?? null, trackId, value.title ?? null,
      value.album_name ?? null, value.track_url ?? null, observedAt, observedAt).run();

  const snapshotDate = value.snapshot_date || regionalMusicSnapshotDate(observedAt);
  await db.prepare(`INSERT INTO regional_music_track_daily(
    snapshot_date,service,service_track_id,observed_at,plays,listeners,likes,comments,popularity_rank,track_id
  ) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_date,service,service_track_id) DO UPDATE SET
    track_id=COALESCE(excluded.track_id,track_id),
    observed_at=excluded.observed_at,
    plays=COALESCE(excluded.plays,plays),
    listeners=COALESCE(excluded.listeners,listeners),
    likes=COALESCE(excluded.likes,likes),
    comments=COALESCE(excluded.comments,comments),
    popularity_rank=COALESCE(excluded.popularity_rank,popularity_rank)
  WHERE (COALESCE(excluded.track_id,track_id)) IS NOT regional_music_track_daily.track_id
    OR (excluded.observed_at) IS NOT regional_music_track_daily.observed_at
    OR (COALESCE(excluded.plays,plays)) IS NOT regional_music_track_daily.plays
    OR (COALESCE(excluded.listeners,listeners)) IS NOT regional_music_track_daily.listeners
    OR (COALESCE(excluded.likes,likes)) IS NOT regional_music_track_daily.likes
    OR (COALESCE(excluded.comments,comments)) IS NOT regional_music_track_daily.comments
    OR (COALESCE(excluded.popularity_rank,popularity_rank)) IS NOT regional_music_track_daily.popularity_rank`)
    .bind(snapshotDate, value.service, value.service_track_id, observedAt,
      count(value.plays), count(value.listeners), count(value.likes), count(value.comments),
      positive(value.popularity_rank), trackId).run();
  if (positive(value.popularity_rank) && value.canonical_artist) {
    const source = value.popularity_rank_source || 'provider_popularity_order';
    if (!['provider_rank','provider_popularity_order','artist_page_order'].includes(source)) throw new Error('Unknown popularity rank source');
    await db.prepare(`INSERT INTO regional_music_artist_track_order(
      snapshot_date,service,canonical_artist,service_artist_id,service_track_id,observed_at,position,rank_source,track_id
    ) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_date,service,canonical_artist,service_track_id) DO UPDATE SET
      service_artist_id=COALESCE(excluded.service_artist_id,service_artist_id),
      track_id=COALESCE(excluded.track_id,track_id),
      observed_at=excluded.observed_at,position=excluded.position,rank_source=excluded.rank_source
  WHERE (COALESCE(excluded.service_artist_id,service_artist_id)) IS NOT regional_music_artist_track_order.service_artist_id
    OR (COALESCE(excluded.track_id,track_id)) IS NOT regional_music_artist_track_order.track_id
    OR (excluded.observed_at) IS NOT regional_music_artist_track_order.observed_at
    OR (excluded.position) IS NOT regional_music_artist_track_order.position
    OR (excluded.rank_source) IS NOT regional_music_artist_track_order.rank_source`)
      .bind(snapshotDate,value.service,value.canonical_artist,value.service_artist_id ?? null,
        value.service_track_id,observedAt,positive(value.popularity_rank),source,trackId).run();
  }
}

export async function saveRegionalRelease(env, value) {
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('releases',value);
  const observedAt = Number(value.observed_at) || Date.now();
  return dbOf(env).prepare(`INSERT INTO regional_music_releases(
    service,service_release_id,canonical_artist,title,release_type,release_year,release_url,first_seen_at,last_seen_at
  ) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(service,service_release_id) DO UPDATE SET
    canonical_artist=excluded.canonical_artist,
    title=COALESCE(excluded.title,title),
    release_type=CASE WHEN excluded.release_type='unknown' THEN release_type ELSE excluded.release_type END,
    release_year=COALESCE(excluded.release_year,release_year),
    release_url=COALESCE(excluded.release_url,release_url),
    last_seen_at=excluded.last_seen_at
  WHERE (excluded.canonical_artist) IS NOT regional_music_releases.canonical_artist
    OR (COALESCE(excluded.title,title)) IS NOT regional_music_releases.title
    OR (CASE WHEN excluded.release_type='unknown' THEN release_type ELSE excluded.release_type END) IS NOT regional_music_releases.release_type
    OR (COALESCE(excluded.release_year,release_year)) IS NOT regional_music_releases.release_year
    OR (COALESCE(excluded.release_url,release_url)) IS NOT regional_music_releases.release_url
    OR (excluded.last_seen_at) IS NOT regional_music_releases.last_seen_at`)
    .bind(value.service, value.service_release_id, value.canonical_artist,
      value.title ?? null, value.release_type || 'unknown', positive(value.release_year),
      value.release_url ?? null, observedAt, observedAt).run();
}

export async function saveRegionalPlaylist(env, value) {
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('playlists',value);
  const observedAt = Number(value.observed_at) || Date.now();
  const db = dbOf(env);
  await db.prepare(`INSERT INTO regional_music_playlists(
    service,service_playlist_id,playlist_name,playlist_url,playlist_type,owner_name,first_seen_at,last_seen_at
  ) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(service,service_playlist_id) DO UPDATE SET
    playlist_name=COALESCE(excluded.playlist_name,playlist_name),
    playlist_url=COALESCE(excluded.playlist_url,playlist_url),
    playlist_type=CASE WHEN excluded.playlist_type='unknown' THEN playlist_type ELSE excluded.playlist_type END,
    owner_name=COALESCE(excluded.owner_name,owner_name),
    last_seen_at=excluded.last_seen_at
  WHERE (COALESCE(excluded.playlist_name,playlist_name)) IS NOT regional_music_playlists.playlist_name
    OR (COALESCE(excluded.playlist_url,playlist_url)) IS NOT regional_music_playlists.playlist_url
    OR (CASE WHEN excluded.playlist_type='unknown' THEN playlist_type ELSE excluded.playlist_type END) IS NOT regional_music_playlists.playlist_type
    OR (COALESCE(excluded.owner_name,owner_name)) IS NOT regional_music_playlists.owner_name
    OR (excluded.last_seen_at) IS NOT regional_music_playlists.last_seen_at`)
    .bind(value.service, value.service_playlist_id, value.playlist_name ?? null,
      value.playlist_url ?? null, value.playlist_type || 'unknown', value.owner_name ?? null,
      observedAt, observedAt).run();
}

export async function saveRegionalPlaylistSnapshot(env, value) {
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('playlist_snapshots',value);
  const observedAt = Number(value.observed_at) || Date.now();
  const snapshotDate = value.snapshot_date || regionalMusicSnapshotDate(observedAt);
  return dbOf(env).prepare(`INSERT INTO regional_music_playlist_snapshots(
    snapshot_date,service,service_playlist_id,observed_at,item_count
  ) VALUES(?,?,?,?,?) ON CONFLICT(snapshot_date,service,service_playlist_id) DO UPDATE SET
    observed_at=excluded.observed_at,
    item_count=excluded.item_count
  WHERE (excluded.observed_at) IS NOT regional_music_playlist_snapshots.observed_at
    OR (excluded.item_count) IS NOT regional_music_playlist_snapshots.item_count`)
    .bind(snapshotDate, value.service, value.service_playlist_id, observedAt, count(value.item_count) ?? 0).run();
}

export async function saveRegionalPlaylistMembership(env, value) {
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('playlist_memberships',value);
  const observedAt = Number(value.observed_at) || Date.now();
  const snapshotDate = value.snapshot_date || regionalMusicSnapshotDate(observedAt);
  const db = dbOf(env);
  const trackId = canonicalTrackId(value);
  return db.prepare(`INSERT INTO regional_music_playlist_memberships(
    snapshot_date,service,service_playlist_id,service_track_id,observed_at,position,track_id
  ) VALUES(?,?,?,?,?,?,COALESCE(?,(
    SELECT canonical_track_id FROM regional_music_tracks
    WHERE service=? AND service_track_id=?
    LIMIT 1
  ))) ON CONFLICT(snapshot_date,service,service_playlist_id,service_track_id) DO UPDATE SET
    track_id=COALESCE(excluded.track_id,track_id),
    observed_at=excluded.observed_at,
    position=COALESCE(excluded.position,position)
  WHERE (COALESCE(excluded.track_id,track_id)) IS NOT regional_music_playlist_memberships.track_id
    OR (excluded.observed_at) IS NOT regional_music_playlist_memberships.observed_at
    OR (COALESCE(excluded.position,position)) IS NOT regional_music_playlist_memberships.position`)
    .bind(snapshotDate, value.service, value.service_playlist_id, value.service_track_id,
      observedAt, positive(value.position), trackId, value.service, value.service_track_id).run();
}

export async function saveRegionalCollectorState(env, value) {
  if (env.REGIONAL_MUSIC_SNAPSHOT_STORE) return env.REGIONAL_MUSIC_SNAPSHOT_STORE('state',value);
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
    updated_at=excluded.updated_at
  WHERE (excluded.status) IS NOT regional_music_collector_state.status
    OR (excluded.last_attempt_at) IS NOT regional_music_collector_state.last_attempt_at
    OR (COALESCE(excluded.last_success_at,last_success_at)) IS NOT regional_music_collector_state.last_success_at
    OR (excluded.last_error_class) IS NOT regional_music_collector_state.last_error_class
    OR (excluded.last_error_message) IS NOT regional_music_collector_state.last_error_message
    OR (excluded.entity_counts_json) IS NOT regional_music_collector_state.entity_counts_json
    OR (excluded.updated_at) IS NOT regional_music_collector_state.updated_at`)
    .bind(value.service, value.status, value.last_attempt_at ?? updatedAt,
      value.last_success_at ?? null, value.last_error_class ?? null,
      value.last_error_message ?? null, JSON.stringify(value.entity_counts || {}), updatedAt).run();
}
