import {
  checkOfficialNews,
  monitorState,
  saveMonitorState,
} from './official-news-announcements.js';
import {
  SH_ORIGIN,
  finite,
  timedFetch,
} from './official-news-utils.js';

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

export const OFFICIAL_PROBE_CONTEXT_SQL = `SELECT auth_token,device_uid
FROM sh_worker_collector_state WHERE id=? LIMIT 1`;

export const OFFICIAL_BUDDIES_STATION_SQL = `SELECT station_id AS buddies_station_id
FROM sh_queue_read_model_current ORDER BY observed_at DESC LIMIT 1`;

export const DECODE_STATION_MAIN_SQL = `UPDATE sh_sakurazaka46jp_main SET
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

const MAIN_ROW_COLUMNS = `observed_at,observed_minute,buddies_station_id,station_id,
  broadcast_id,broadcast_start_time,is_broadcasting,listener_count,guest_count,
  total_listens,status,chat_status,channel_id,channel_alias`;
const MAIN_ROW_SQL = `SELECT ${MAIN_ROW_COLUMNS}
FROM sh_sakurazaka46jp_main WHERE observed_minute=? LIMIT 1`;
const MAIN_VALID_ROW_SQL = `SELECT ${MAIN_ROW_COLUMNS},json_valid(raw_json) AS raw_valid
FROM sh_sakurazaka46jp_main WHERE observed_minute=? LIMIT 1`;

function observedMinute(now) {
  return Math.floor(Number(now) / 60000);
}

function authStateId(env) {
  return String(env?.SAKURAZAKA_AUTH_STATE_ID || 'sakurazaka46jp').trim().toLowerCase()
    || 'sakurazaka46jp';
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

export async function loadOfficialSession(env) {
  return env.OTHER_DB.prepare(OFFICIAL_PROBE_CONTEXT_SQL).bind(authStateId(env)).first();
}

export async function loadOfficialProbeContext(env) {
  const stationRead = env?.MINUTE_DB?.prepare
    ? env.MINUTE_DB.prepare(OFFICIAL_BUDDIES_STATION_SQL).first()
    : Promise.resolve(null);
  const [session, station] = await Promise.all([
    loadOfficialSession(env),
    stationRead,
  ]);
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

async function dueAnnouncements(env, cfg, now) {
  const result = await env.OTHER_DB.prepare(`SELECT
      id,event_name,scheduled_at,status,inactive_streak,first_broadcast_at
    FROM sh_official_news_announcements
    WHERE scheduled_at IS NOT NULL AND (
      (status='scheduled' AND scheduled_at>=? AND scheduled_at<=?)
      OR status='active'
    )
    ORDER BY scheduled_at ASC LIMIT 5`)
    .bind(now - cfg.lateWindowMs, now + cfg.earlyWindowMs).all();
  return result.results || [];
}

export async function collectStationMain(env, cfg, now, dependencies = {}) {
  const session = await (dependencies.loadContext || loadOfficialProbeContext)(env);
  if (!session?.auth_token || !session?.device_uid) {
    throw new Error('Stationhead worker session unavailable');
  }
  const fetchText = dependencies.stationTextRequest || stationTextRequest;
  const rawText = await fetchText(
    `/station/handle/${encodeURIComponent(cfg.handle)}/guest`,
    cfg,
    session,
    { method: 'POST', body: '{}' },
  );
  const minute = observedMinute(now);
  await env.OTHER_DB.prepare(`INSERT INTO sh_sakurazaka46jp_main
      (observed_at,observed_minute,buddies_station_id,raw_json)
    VALUES (?,?,?,?)
    ON CONFLICT(observed_minute) DO UPDATE SET
      observed_at=excluded.observed_at,
      buddies_station_id=excluded.buddies_station_id,
      raw_json=excluded.raw_json`)
    .bind(now, minute, finite(session.buddies_station_id), rawText).run();
  return { skipped: false, observed_minute: minute };
}

export async function decodeStationMain(env, _cfg, now) {
  const minute = observedMinute(now);
  await env.OTHER_DB.prepare(DECODE_STATION_MAIN_SQL).bind(minute).run();
  const row = await env.OTHER_DB.prepare(MAIN_VALID_ROW_SQL).bind(minute).first();
  if (!row) throw new Error('Sakurazaka main raw row is missing');
  if (Number(row.raw_valid) !== 1) throw new Error('Sakurazaka main raw response is not valid JSON');
  return {
    skipped: false,
    observed_minute: minute,
    station_id: finite(row.station_id),
    active: activeMainRow(row),
  };
}

export async function collectStationChat(env, cfg, now, dependencies = {}) {
  const minute = observedMinute(now);
  const main = await env.OTHER_DB.prepare(MAIN_ROW_SQL).bind(minute).first();
  if (!main) throw new Error('Sakurazaka main row is missing before chat collection');
  if (!activeMainRow(main)) return { skipped: true, reason: 'station-inactive' };

  const session = await (dependencies.loadSession || loadOfficialSession)(env);
  if (!session?.auth_token || !session?.device_uid) {
    throw new Error('Stationhead worker session unavailable');
  }
  const stationId = finite(main.station_id);
  const fetchText = dependencies.stationTextRequest || stationTextRequest;
  const rawText = await fetchText(`/station/${stationId}/chatHistory?limit=50`, cfg, session);
  await env.OTHER_DB.prepare(`INSERT INTO sh_sakurazaka46jp_chat
      (observed_at,observed_minute,station_id,raw_json)
    VALUES (?,?,?,?)
    ON CONFLICT(observed_minute) DO UPDATE SET
      observed_at=excluded.observed_at,
      station_id=excluded.station_id,
      raw_json=excluded.raw_json`)
    .bind(now, minute, stationId, rawText).run();
  return { skipped: false, observed_minute: minute, station_id: stationId };
}

function probeStatement(env, announcement, main, active, now) {
  return env.OTHER_DB.prepare(`INSERT INTO sh_official_news_station_probes
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

export async function finalizeStationProbe(env, cfg, now) {
  const minute = observedMinute(now);
  const main = await env.OTHER_DB.prepare(MAIN_ROW_SQL).bind(minute).first();
  if (!main) throw new Error('Sakurazaka main row is missing before finalization');
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
      statements.push(env.OTHER_DB.prepare(`UPDATE sh_official_news_announcements SET
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
      statements.push(env.OTHER_DB.prepare(`UPDATE sh_official_news_announcements SET
          inactive_streak=?,status=CASE WHEN ?>=? THEN 'ended' ELSE status END,updated_at=? WHERE id=?`)
        .bind(streak, streak, cfg.endConfirmPolls, now, announcement.id));
    }
  }
  await env.OTHER_DB.batch(statements);
  console.log(JSON.stringify({
    event: 'official_news_broadcast_probe',
    observed_minute: minute,
    station_id: finite(main.station_id),
    active,
    announcements: announcements.length,
  }));
  return { skipped: false, active, announcements: announcements.length };
}

export async function probeAnnouncements() {
  return { skipped: true, reason: 'split-stages-required' };
}

export async function runOfficialNewsMonitor(env, cfg, now, dependencies = {}) {
  if (!env.OTHER_DB) return;
  const check = dependencies.checkOfficialNews || checkOfficialNews;
  const readState = dependencies.monitorState || monitorState;
  const writeState = dependencies.saveMonitorState || saveMonitorState;
  try {
    await check(env, cfg, now);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    const state = await readState(env).catch(() => null);
    await writeState(env, {
      lastCheckAt: finite(state?.last_check_at) ?? now,
      lastSuccessAt: finite(state?.last_success_at),
      lastError: message,
    }).catch(() => {});
    console.error(JSON.stringify({ event: 'official_news_monitor_failed', error: message }));
  }
}
