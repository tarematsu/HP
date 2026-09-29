import { finiteNumber as finite, timedFetch } from './shared.js';

const SH_ORIGIN = 'https://production1.stationhead.com';
const ANNOUNCEMENTS = 'sh_nogizaka_official_news_announcements';
const PROBES = 'sh_nogizaka_official_news_station_probes';
const MAIN = 'sh_nogizaka46smej_main';
const CHAT = 'sh_nogizaka46smej_chat';

function stationHeaders(cfg, session) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    'app-platform': 'web',
    'app-version': cfg.appVersion,
    'content-type': 'application/json',
    origin: 'https://www.stationhead.com',
    referer: 'https://www.stationhead.com/',
    'sth-device-uid': session.device_uid,
    authorization: `Bearer ${session.auth_token}`,
  };
}

function authStateId(env) {
  return String(env?.SAKURAZAKA_AUTH_STATE_ID || 'nogizaka46smej').trim().toLowerCase()
    || 'nogizaka46smej';
}

function observedMinute(now) {
  return Math.floor(Number(now) / 60_000);
}

function activeMainRow(row) {
  const stationId = finite(row?.station_id);
  const buddiesStationId = finite(row?.buddies_station_id);
  return Boolean(
    Number(row?.is_broadcasting) === 1
    && finite(row?.broadcast_id) != null
    && stationId != null
    && (buddiesStationId == null || stationId !== buddiesStationId)
  );
}

const MAIN_COLUMNS = `observed_at,observed_minute,buddies_station_id,station_id,
  broadcast_id,broadcast_start_time,is_broadcasting,listener_count,guest_count,
  total_listens,status,chat_status,channel_id,channel_alias`;

export const NOGIZAKA_DECODE_MAIN_SQL = `UPDATE ${MAIN} SET
  station_id=CASE WHEN json_valid(raw_json) THEN CAST(COALESCE(
    json_extract(raw_json,'$.id'),json_extract(raw_json,'$.broadcast.station_id')) AS INTEGER) END,
  broadcast_id=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.broadcast.id') AS INTEGER) END,
  broadcast_start_time=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.broadcast.start_time') AS INTEGER) END,
  is_broadcasting=CASE WHEN json_valid(raw_json)
    THEN COALESCE(CAST(json_extract(raw_json,'$.is_broadcasting') AS INTEGER),0) ELSE 0 END,
  listener_count=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.listener_count') AS INTEGER) END,
  guest_count=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.guest_count') AS INTEGER) END,
  total_listens=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.total_listens') AS INTEGER) END,
  status=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.status') AS TEXT) END,
  chat_status=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.chat_status') AS TEXT) END,
  channel_id=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.channel.id') AS INTEGER) END,
  channel_alias=CASE WHEN json_valid(raw_json) THEN CAST(json_extract(raw_json,'$.channel.alias') AS TEXT) END
WHERE observed_minute=?`;

async function loadSession(env) {
  return env.OTHER_DB.prepare(`SELECT auth_token,device_uid
      FROM sh_worker_collector_state WHERE id=? LIMIT 1`)
    .bind(authStateId(env))
    .first();
}

async function loadContext(env) {
  const stationRead = env?.MINUTE_DB?.prepare
    ? env.MINUTE_DB.prepare(`SELECT station_id AS buddies_station_id
        FROM sh_queue_read_model_current ORDER BY observed_at DESC LIMIT 1`).first()
    : Promise.resolve(null);
  const [session, station] = await Promise.all([loadSession(env), stationRead]);
  return { ...session, buddies_station_id: station?.buddies_station_id ?? null };
}

async function stationTextRequest(path, cfg, session, options = {}) {
  const response = await timedFetch(`${SH_ORIGIN}${path}`, {
    ...options,
    headers: { ...stationHeaders(cfg, session), ...(options.headers || {}) },
  }, cfg.requestTimeoutMs);
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Stationhead ${response.status}: ${path}${rawText ? ` | ${rawText.slice(0, 180)}` : ''}`);
  }
  return rawText;
}

export async function collectNogizakaStationMain(env, cfg, now, dependencies = {}) {
  const session = await (dependencies.loadContext || loadContext)(env);
  if (!session?.auth_token || !session?.device_uid) {
    throw new Error('Nogizaka Stationhead worker session unavailable');
  }
  const rawText = await (dependencies.stationTextRequest || stationTextRequest)(
    `/station/handle/${encodeURIComponent(cfg.handle)}/guest`,
    cfg,
    session,
    { method: 'POST', body: '{}' },
  );
  const minute = observedMinute(now);
  await env.OTHER_DB.prepare(`INSERT INTO ${MAIN}
      (observed_at,observed_minute,buddies_station_id,raw_json)
      VALUES (?,?,?,?)
      ON CONFLICT(observed_minute) DO UPDATE SET
        observed_at=excluded.observed_at,
        buddies_station_id=excluded.buddies_station_id,
        raw_json=excluded.raw_json`)
    .bind(now, minute, finite(session.buddies_station_id), rawText)
    .run();
  return { skipped: false, observed_minute: minute };
}

export async function decodeNogizakaStationMain(env, _cfg, now) {
  const minute = observedMinute(now);
  await env.OTHER_DB.prepare(NOGIZAKA_DECODE_MAIN_SQL).bind(minute).run();
  const row = await env.OTHER_DB.prepare(`SELECT ${MAIN_COLUMNS},json_valid(raw_json) AS raw_valid
      FROM ${MAIN} WHERE observed_minute=? LIMIT 1`)
    .bind(minute)
    .first();
  if (!row) throw new Error('Nogizaka main raw row is missing');
  if (Number(row.raw_valid) !== 1) throw new Error('Nogizaka main raw response is not valid JSON');
  return {
    skipped: false,
    observed_minute: minute,
    station_id: finite(row.station_id),
    active: activeMainRow(row),
  };
}

export async function collectNogizakaStationChat(env, cfg, now, dependencies = {}) {
  const minute = observedMinute(now);
  const main = await env.OTHER_DB.prepare(`SELECT ${MAIN_COLUMNS}
      FROM ${MAIN} WHERE observed_minute=? LIMIT 1`)
    .bind(minute)
    .first();
  if (!main) throw new Error('Nogizaka main row is missing before chat collection');
  if (!activeMainRow(main)) return { skipped: true, reason: 'station-inactive' };

  const session = await (dependencies.loadSession || loadSession)(env);
  if (!session?.auth_token || !session?.device_uid) {
    throw new Error('Nogizaka Stationhead worker session unavailable');
  }
  const stationId = finite(main.station_id);
  const rawText = await (dependencies.stationTextRequest || stationTextRequest)(
    `/station/${stationId}/chatHistory?limit=50`,
    cfg,
    session,
  );
  await env.OTHER_DB.prepare(`INSERT INTO ${CHAT}
      (observed_at,observed_minute,station_id,raw_json)
      VALUES (?,?,?,?)
      ON CONFLICT(observed_minute) DO UPDATE SET
        observed_at=excluded.observed_at,
        station_id=excluded.station_id,
        raw_json=excluded.raw_json`)
    .bind(now, minute, stationId, rawText)
    .run();
  return { skipped: false, observed_minute: minute, station_id: stationId };
}

async function dueAnnouncements(env, cfg, now) {
  const result = await env.OTHER_DB.prepare(`SELECT
      id,event_name,scheduled_at,status,inactive_streak,first_broadcast_at
    FROM ${ANNOUNCEMENTS}
    WHERE scheduled_at IS NOT NULL AND (
      (status='scheduled' AND scheduled_at>=? AND scheduled_at<=?) OR status='active'
    )
    ORDER BY scheduled_at ASC LIMIT 5`)
    .bind(now - cfg.lateWindowMs, now + cfg.earlyWindowMs)
    .all();
  return result.results || [];
}

function probeStatement(env, announcement, main, active, now) {
  return env.OTHER_DB.prepare(`INSERT INTO ${PROBES}
      (announcement_id,observed_at,observed_minute,station_id,broadcast_id,broadcast_start_time,
       is_broadcasting,listener_count,guest_count,total_listens,status,chat_status,
       channel_id,channel_alias,queue_json,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)
    ON CONFLICT(announcement_id,observed_minute) DO UPDATE SET
      observed_at=excluded.observed_at,station_id=excluded.station_id,broadcast_id=excluded.broadcast_id,
      broadcast_start_time=excluded.broadcast_start_time,is_broadcasting=excluded.is_broadcasting,
      listener_count=excluded.listener_count,guest_count=excluded.guest_count,
      total_listens=excluded.total_listens,status=excluded.status,chat_status=excluded.chat_status,
      channel_id=excluded.channel_id,channel_alias=excluded.channel_alias,
      queue_json=NULL,raw_json=NULL`)
    .bind(
      announcement.id,
      now,
      observedMinute(now),
      finite(main.station_id),
      finite(main.broadcast_id),
      finite(main.broadcast_start_time),
      active ? 1 : 0,
      finite(main.listener_count),
      finite(main.guest_count),
      finite(main.total_listens),
      main.status || null,
      main.chat_status || null,
      finite(main.channel_id),
      main.channel_alias || null,
    );
}

export async function finalizeNogizakaStationProbe(env, cfg, now) {
  const minute = observedMinute(now);
  const main = await env.OTHER_DB.prepare(`SELECT ${MAIN_COLUMNS}
      FROM ${MAIN} WHERE observed_minute=? LIMIT 1`)
    .bind(minute)
    .first();
  if (!main) throw new Error('Nogizaka main row is missing before finalization');
  const announcements = await dueAnnouncements(env, cfg, now);
  if (!announcements.length) return { skipped: true, reason: 'no-due-announcement' };

  const active = activeMainRow(main);
  const statements = announcements.map((announcement) => probeStatement(
    env,
    announcement,
    main,
    active,
    now,
  ));
  if (active) {
    for (const announcement of announcements) {
      statements.push(env.OTHER_DB.prepare(`UPDATE ${ANNOUNCEMENTS} SET
          status='active',matched_station_id=?,first_broadcast_at=COALESCE(first_broadcast_at,?),
          last_broadcast_at=?,inactive_streak=0,updated_at=? WHERE id=?`)
        .bind(
          finite(main.station_id),
          finite(main.broadcast_start_time) || now,
          now,
          now,
          announcement.id,
        ));
    }
  } else {
    for (const announcement of announcements) {
      if (announcement.status !== 'active') continue;
      const streak = Number(announcement.inactive_streak || 0) + 1;
      statements.push(env.OTHER_DB.prepare(`UPDATE ${ANNOUNCEMENTS} SET
          inactive_streak=?,status=CASE WHEN ?>=? THEN 'ended' ELSE status END,
          updated_at=? WHERE id=?`)
        .bind(streak, streak, cfg.endConfirmPolls, now, announcement.id));
    }
  }
  await env.OTHER_DB.batch(statements);
  console.log(JSON.stringify({
    event: 'nogizaka_official_news_broadcast_probe',
    observed_minute: minute,
    station_id: finite(main.station_id),
    active,
    announcements: announcements.length,
  }));
  return { skipped: false, active, announcements: announcements.length };
}
