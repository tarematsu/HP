import { persistHostEvent } from '../../site/functions/lib/host-ingest.js';
import {
  finite,
  identity,
  normalizeProfile,
  normalizeQueue,
  queueHash,
} from './cloud-host-monitor-normalize.js';

const SOURCE_SCOPE = 'nogizaka46smej_solo';
const DEFAULT_HANDLE = 'nogizaka46smej';
const COLLECTOR_ID = 'sh-nogizaka46smej-raw';
const MAIN = 'sh_nogizaka46smej_main';
const TRACK_METADATA = 'sh_nogizaka46smej_track_metadata';

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function observedMinute(now) {
  return Math.floor(Number(now) / 60_000);
}

function handleFromEnv(env) {
  return String(env?.SOLO_BROADCAST_HANDLE || DEFAULT_HANDLE).trim().toLowerCase() || DEFAULT_HANDLE;
}

function parseRawJson(value, label, { allowArray = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ''));
  } catch (error) {
    throw new Error(`${label} raw JSON parse failed: ${String(error?.message || error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || (!allowArray && Array.isArray(parsed))) {
    throw new Error(`${label} raw JSON root has an unsupported shape`);
  }
  return parsed;
}

async function minuteRow(env, now) {
  const minute = observedMinute(now);
  const main = await env.OTHER_DB.prepare(`SELECT
      observed_at,observed_minute,buddies_station_id,station_id,broadcast_id,
      broadcast_start_time,is_broadcasting,listener_count,guest_count,total_listens,
      status,chat_status,channel_id,channel_alias,raw_json
    FROM ${MAIN} WHERE observed_minute=? LIMIT 1`).bind(minute).first();
  return { minute, main };
}

async function openSession(env, handle) {
  return env.OTHER_DB.prepare(`SELECT
      id,station_id,status,started_at,confirmed_at,last_observed_at
    FROM sh_host_broadcast_sessions
    WHERE source_scope=? AND handle=? AND status IN ('provisional','active')
    ORDER BY started_at DESC,id DESC LIMIT 1`)
    .bind(SOURCE_SCOPE, handle)
    .first();
}

function activeMainRow(main) {
  const stationId = finite(main?.station_id);
  const buddiesStationId = finite(main?.buddies_station_id);
  return Boolean(
    Number(main?.is_broadcasting) === 1
    && finite(main?.broadcast_id) != null
    && stationId != null
    && (buddiesStationId == null || stationId !== buddiesStationId)
  );
}

function stationAccount(station) {
  const broadcasters = station?.broadcast?.broadcasters;
  const host = Array.isArray(broadcasters)
    ? broadcasters.find((item) => item?.is_host) || broadcasters[0]
    : null;
  return station?.owner || host?.account || station?.account || null;
}

function profileFromStation(station, handle) {
  const profile = normalizeProfile(stationAccount(station), handle);
  if (!profile) return null;
  if (profile.account_id == null && profile.followers == null && profile.total_streams == null) return null;
  return profile;
}

async function writeEvent(env, type, data, observedAt) {
  const result = await persistHostEvent({ OTHER_DB: env.OTHER_DB, DB: env.OTHER_DB }, {
    type,
    observed_at: observedAt,
    collector_id: COLLECTOR_ID,
    collector_kind: 'cloud',
    source_priority: 100,
    data,
  });
  if (!result?.ok) {
    throw new Error(`${type} materialization failed: ${String(result?.error || 'unknown error')}`);
  }
  return result;
}

async function openRawSession(env, handle, station, main, observedAt) {
  const stationIdentity = identity(station);
  const result = await writeEvent(env, 'solo_session_open', {
    source_scope: SOURCE_SCOPE,
    handle,
    account_id: stationIdentity.accountId,
    station_id: stationIdentity.stationId ?? finite(main.station_id),
    broadcast_id: stationIdentity.broadcastId ?? finite(main.broadcast_id),
    broadcast_stream_id: stationIdentity.broadcastStreamId,
    started_at: stationIdentity.broadcastStartTime || finite(main.broadcast_start_time) || observedAt,
    detection_reason: 'official_news_raw',
    buddies_station_id: finite(main.buddies_station_id),
    channel_id: stationIdentity.channelId ?? finite(main.channel_id),
    channel_alias: stationIdentity.channelAlias || main.channel_alias || null,
    total_listens_start: finite(main.total_listens ?? station?.total_listens),
  }, observedAt);
  if (!result.session_id) throw new Error('Nogizaka raw-derived session open returned no session ID');
  return {
    id: Number(result.session_id),
    station_id: stationIdentity.stationId ?? finite(main.station_id),
    status: 'provisional',
    started_at: stationIdentity.broadcastStartTime || finite(main.broadcast_start_time) || observedAt,
    confirmed_at: null,
    last_observed_at: observedAt,
  };
}

async function closeRawSession(env, session, station, main, observedAt, reason) {
  const profile = profileFromStation(station, handleFromEnv(env));
  const status = session?.status === 'provisional' ? 'cancelled' : 'ended';
  await writeEvent(env, 'solo_session_close', {
    session_id: Number(session.id),
    ended_at: observedAt,
    status,
    end_reason: reason,
    total_listens_end: finite(main?.total_listens ?? station?.total_listens),
    followers_end: profile?.followers ?? null,
    total_streams_end: profile?.total_streams ?? null,
  }, observedAt);
  return status;
}

async function inactiveConfirmed(env, minute, count) {
  const result = await env.OTHER_DB.prepare(`SELECT
      station_id,buddies_station_id,broadcast_id,is_broadcasting
    FROM ${MAIN}
    WHERE observed_minute<=?
    ORDER BY observed_minute DESC LIMIT ?`).bind(minute, count).all();
  const rows = result.results || [];
  if (rows.length < count) return false;
  return rows.every((row) => !activeMainRow(row));
}

async function saveProfile(env, sessionId, station, handle, observedAt) {
  const profile = profileFromStation(station, handle);
  if (!profile) return false;
  await writeEvent(env, 'host_profile_snapshot', {
    ...profile,
    session_id: sessionId,
    source_scope: SOURCE_SCOPE,
  }, observedAt);
  await env.OTHER_DB.prepare(`UPDATE sh_host_broadcast_sessions SET
      followers_end=COALESCE(?,followers_end),
      total_streams_end=COALESCE(?,total_streams_end)
    WHERE id=?`).bind(profile.followers, profile.total_streams, sessionId).run();
  return true;
}

async function saveStationMinute(env, sessionId, handle, station, main, queue, observedAt) {
  const stationIdentity = identity(station);
  await writeEvent(env, 'solo_station_snapshot', {
    session_id: sessionId,
    source_scope: SOURCE_SCOPE,
    handle,
    account_id: stationIdentity.accountId,
    station_id: stationIdentity.stationId ?? finite(main.station_id),
    broadcast_id: stationIdentity.broadcastId ?? finite(main.broadcast_id),
    broadcast_start_time: stationIdentity.broadcastStartTime ?? finite(main.broadcast_start_time),
    is_broadcasting: station?.is_broadcasting ?? Boolean(Number(main.is_broadcasting)),
    status: station?.status ?? main.status ?? null,
    chat_status: station?.chat_status ?? main.chat_status ?? null,
    listener_count: finite(station?.listener_count ?? main.listener_count),
    guest_count: finite(station?.guest_count ?? main.guest_count),
    total_listens: finite(station?.total_listens ?? main.total_listens),
    channel_id: stationIdentity.channelId ?? finite(main.channel_id),
    channel_alias: stationIdentity.channelAlias ?? main.channel_alias ?? null,
    current_track_id: queue?.current_track_id ?? null,
    current_spotify_id: queue?.current_spotify_id ?? null,
    queue_id: queue?.queue_id ?? null,
    queue_start_time: queue?.start_time ?? null,
  }, observedAt);
}

async function saveTrackMetadataMinute(env, sessionId, queue, observedAt) {
  if (!queue?.tracks?.length) return 0;
  const statements = queue.tracks.map((track) => env.OTHER_DB.prepare(`INSERT INTO ${TRACK_METADATA} (
      session_id,observed_at,station_id,queue_id,queue_start_time,position,
      queue_track_id,stationhead_track_id,spotify_id,apple_music_id,deezer_id,isrc,
      duration_ms,preview_url,bite_count,title,artist,album_name,thumbnail_url
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(session_id,observed_at,position) DO UPDATE SET
      station_id=excluded.station_id,queue_id=excluded.queue_id,
      queue_start_time=excluded.queue_start_time,queue_track_id=excluded.queue_track_id,
      stationhead_track_id=excluded.stationhead_track_id,spotify_id=excluded.spotify_id,
      apple_music_id=excluded.apple_music_id,deezer_id=excluded.deezer_id,isrc=excluded.isrc,
      duration_ms=excluded.duration_ms,preview_url=excluded.preview_url,
      bite_count=excluded.bite_count,title=excluded.title,artist=excluded.artist,
      album_name=excluded.album_name,thumbnail_url=excluded.thumbnail_url`)
    .bind(
      sessionId,
      observedAt,
      queue.station_id,
      queue.queue_id,
      queue.start_time,
      track.position,
      track.queue_track_id,
      track.stationhead_track_id,
      track.spotify_id,
      track.apple_music_id,
      track.deezer_id,
      track.isrc,
      track.duration_ms,
      track.preview_url,
      track.bite_count,
      track.title,
      track.artist,
      track.album_name,
      track.thumbnail_url,
    ));
  await env.OTHER_DB.batch(statements);
  return statements.length;
}

async function saveQueueMinute(env, sessionId, queue, observedAt) {
  if (!queue) return { saved: false, metadata: 0 };
  const hash = await queueHash(queue);
  await writeEvent(env, 'solo_queue', {
    session_id: sessionId,
    queue_hash: hash,
    ...queue,
  }, observedAt);
  return {
    saved: true,
    metadata: await saveTrackMetadataMinute(env, sessionId, queue, observedAt),
  };
}

export async function materializeNogizakaRawMinute(env, now = Date.now()) {
  if (!env?.OTHER_DB?.prepare) return { skipped: true, reason: 'other-db-binding-missing' };
  const handle = handleFromEnv(env);
  const { minute, main } = await minuteRow(env, now);
  if (!main?.raw_json) return { skipped: true, reason: 'main-raw-missing', observed_minute: minute };

  const observedAt = finite(main.observed_at) || Number(now);
  const station = parseRawJson(main.raw_json, 'Nogizaka main');
  const active = activeMainRow(main);
  let session = await openSession(env, handle);
  let opened = false;

  if (active && session && finite(session.station_id) !== finite(main.station_id)) {
    await closeRawSession(env, session, station, main, observedAt, 'station_changed');
    session = null;
  }

  if (active && !session) {
    session = await openRawSession(env, handle, station, main, observedAt);
    opened = true;
  }

  if (!session) {
    return {
      skipped: true,
      reason: 'station-inactive',
      observed_minute: minute,
      active: false,
    };
  }

  const queue = normalizeQueue(station, observedAt);
  await saveStationMinute(env, Number(session.id), handle, station, main, queue, observedAt);

  let queueSaved = false;
  let trackMetadataWritten = 0;
  let profileSaved = false;
  if (active) {
    const queueResult = await saveQueueMinute(env, Number(session.id), queue, observedAt);
    queueSaved = queueResult.saved;
    trackMetadataWritten = queueResult.metadata;
    profileSaved = await saveProfile(env, Number(session.id), station, handle, observedAt);

    if (!opened && session.status === 'provisional') {
      await writeEvent(env, 'solo_session_confirm', {
        session_id: Number(session.id),
        confirmed_at: observedAt,
      }, observedAt);
      session.status = 'active';
    }
  } else {
    const endPolls = positive(env.OFFICIAL_NEWS_END_CONFIRM_POLLS, 2);
    if (await inactiveConfirmed(env, minute, endPolls)) {
      session.status = await closeRawSession(env, session, station, main, observedAt, 'not_broadcasting');
    }
  }

  console.log(JSON.stringify({
    event: 'nogizaka_raw_materialized',
    observed_minute: minute,
    session_id: Number(session.id),
    station_id: finite(main.station_id),
    active,
    session_status: session.status,
    queue_saved: queueSaved,
    track_metadata_written: trackMetadataWritten,
    profile_saved: profileSaved,
  }));

  return {
    skipped: false,
    observed_minute: minute,
    session_id: Number(session.id),
    station_id: finite(main.station_id),
    active,
    session_status: session.status,
    queue_saved: queueSaved,
    track_metadata_written: trackMetadataWritten,
    profile_saved: profileSaved,
  };
}