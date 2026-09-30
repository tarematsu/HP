export const OFFICIAL_STATUS_CACHE_CONTROL = 'no-store';
export const ACTIVE_MAIN_LIMIT = 180;
export const IDLE_MAIN_LIMIT = 1;
export const ACTIVE_REFRESH_MS = 15_000;
export const IDLE_REFRESH_MS = 60_000;
export const DEFAULT_LATE_WINDOW_MS = 90 * 60_000;

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': OFFICIAL_STATUS_CACHE_CONTROL,
});
const SAFE_IDENTIFIER = /^[a-z0-9_]+$/i;
const SAFE_HANDLE = /^[a-z0-9_]+$/i;

function sqlIdentifier(value) {
  const text = String(value || '');
  if (!SAFE_IDENTIFIER.test(text)) throw new Error(`invalid SQL identifier: ${text}`);
  return text;
}

function sqlHandle(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!SAFE_HANDLE.test(text)) throw new Error(`invalid official account handle: ${text}`);
  return text;
}

export function officialStatusJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function officialLateWindowMs(env = {}) {
  const configured = Math.trunc(Number(env.OFFICIAL_NEWS_LATE_WINDOW_MS));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LATE_WINDOW_MS;
}

export function officialAnnouncementSql(tableName) {
  const table = sqlIdentifier(tableName);
  return `SELECT id,event_name,scheduled_at,first_broadcast_at,last_broadcast_at,status
    FROM ${table}
    WHERE status='active'
       OR (status='scheduled' AND scheduled_at>=?)
    ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,
      CASE WHEN status='active' THEN COALESCE(first_broadcast_at,scheduled_at) END DESC,
      CASE WHEN status='scheduled' THEN scheduled_at END ASC,
      id DESC
    LIMIT 1`;
}

export function officialMainSql({ tableName, handle, limit }) {
  const table = sqlIdentifier(tableName);
  const targetHandle = sqlHandle(handle);
  const rowLimit = Math.max(1, Math.trunc(Number(limit)) || IDLE_MAIN_LIMIT);
  return `SELECT m.observed_at,m.observed_minute,m.station_id,m.broadcast_id,m.broadcast_start_time,
      m.is_broadcasting,m.listener_count,m.guest_count,m.total_listens,m.status,m.chat_status,m.channel_id,m.channel_alias,
      CASE WHEN json_valid(m.raw_json) THEN CAST(COALESCE(
        json_extract(m.raw_json,'$.owner.followers'),
        json_extract(m.raw_json,'$.account.followers'),
        json_extract(m.raw_json,'$.broadcast.broadcasters[0].account.followers')
      ) AS INTEGER) END AS followers,
      CASE WHEN json_valid(m.raw_json) THEN CAST(COALESCE(
        json_extract(m.raw_json,'$.owner.following'),
        json_extract(m.raw_json,'$.account.following'),
        json_extract(m.raw_json,'$.broadcast.broadcasters[0].account.following')
      ) AS INTEGER) END AS following,
      CASE WHEN json_valid(m.raw_json) THEN CAST(COALESCE(
        json_extract(m.raw_json,'$.owner.total_streams'),
        json_extract(m.raw_json,'$.account.total_streams'),
        json_extract(m.raw_json,'$.broadcast.broadcasters[0].account.total_streams')
      ) AS INTEGER) END AS total_streams,
      json_valid(m.raw_json) AS raw_valid,length(m.raw_json) AS raw_bytes
    FROM ${table} AS m
    WHERE NOT EXISTS (
      SELECT 1 FROM sh_sakurazaka46jp_collection_tests AS t
      WHERE t.target_handle='${targetHandle}'
        AND m.observed_at>=t.started_at AND m.observed_at<t.ends_at
    )
    ORDER BY m.observed_at DESC,m.id DESC
    LIMIT ${rowLimit}`;
}

export function officialCollectionActive(event) {
  return event?.status === 'active';
}

export function officialMainLimit(active) {
  return active ? ACTIVE_MAIN_LIMIT : IDLE_MAIN_LIMIT;
}

export function officialRefreshHint(active) {
  return active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
}

export function officialStatusPayload({ handle, generatedAt, event = null, samples = [] } = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  const latest = rows[0] || null;
  const active = officialCollectionActive(event);
  return {
    ok: true,
    handle: sqlHandle(handle),
    generated_at: generatedAt,
    collection_active: active,
    event: event || null,
    latest,
    latest_age_ms: latest ? Math.max(0, generatedAt - Number(latest.observed_at)) : null,
    samples: rows,
    sample_count: rows.length,
    recent_limit: officialMainLimit(active),
    refresh_hint_ms: officialRefreshHint(active),
  };
}

export function officialEmptyStatusPayload(handle, generatedAt) {
  return officialStatusPayload({ handle, generatedAt, event: null, samples: [] });
}
