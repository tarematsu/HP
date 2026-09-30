import {
  publishedDate,
  scheduleTimes,
  stripHtml,
} from './official-news-html.js';
import { timedFetch } from './shared.js';

export const NOGIZAKA_NEWS_LIST_URL = 'https://www.nogizaka46.com/s/n46/news/list';
export const NOGIZAKA_NEWS_API_URL = 'https://www.nogizaka46.com/s/n46/api/list/news_v2?rw=400';
export const NOGIZAKA_NEWS_ORIGIN = 'https://www.nogizaka46.com';
export const NOGIZAKA_MONITOR_STATE_ID = 'official-news:nogizaka46smej';
export const NOGIZAKA_HANDLE = 'nogizaka46smej';

const ANNOUNCEMENTS = 'sh_nogizaka_official_news_announcements';
const PROBES = 'sh_nogizaka_official_news_station_probes';
const NEWS_HEADERS = Object.freeze({
  accept: 'text/html,application/xhtml+xml',
  'user-agent': 'stationhead-monitor/1.0',
});
const NEWS_API_HEADERS = Object.freeze({
  accept: 'application/json',
  'user-agent': 'stationhead-monitor/1.0',
});

function positive(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegative(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function nogizakaOfficialNewsConfig(env = {}) {
  return {
    checkIntervalMs: positive(env.OFFICIAL_NEWS_CHECK_INTERVAL_MS, 60 * 60_000),
    earlyWindowMs: nonNegative(env.OFFICIAL_NEWS_EARLY_WINDOW_MS, 0),
    lateWindowMs: positive(env.OFFICIAL_NEWS_LATE_WINDOW_MS, 90 * 60_000),
    endConfirmPolls: positive(env.OFFICIAL_NEWS_END_CONFIRM_POLLS, 2),
    articleLimit: Math.min(positive(env.OFFICIAL_NEWS_ARTICLE_LIMIT, 200), 200),
    bodyScanCount: Math.min(positive(env.OFFICIAL_NEWS_BODY_SCAN_COUNT, 5), 20),
    handle: String(env.SOLO_BROADCAST_HANDLE || NOGIZAKA_HANDLE).trim().toLowerCase()
      || NOGIZAKA_HANDLE,
    appVersion: String(env.STATIONHEAD_APP_VERSION || env.SH_APP_VERSION || '1.0.0'),
    requestTimeoutMs: Math.min(positive(env.REQUEST_TIMEOUT_MS, 8_000), 30_000),
  };
}

export function nogizakaNewsApiCandidates(payload, cfg = {}) {
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error('Nogizaka official news API returned an unexpected payload');
  }
  if (!payload.data.length) {
    throw new Error('Nogizaka official news API returned no news rows');
  }

  const articleLimit = Math.min(positive(cfg.articleLimit, 200), payload.data.length);
  const bodyScanCount = Math.min(positive(cfg.bodyScanCount, 5), articleLimit);
  const candidates = [];
  const seen = new Set();

  for (const [index, row] of payload.data.slice(0, articleLimit).entries()) {
    const newsId = String(row?.code || '').trim();
    const listTitle = stripHtml(row?.title || '');
    const listText = stripHtml(row?.text || '');
    if (!newsId || seen.has(newsId)) continue;
    if (index >= bodyScanCount && !/station\s*head/i.test(`${listTitle}\n${listText}`)) continue;

    let href;
    try {
      href = new URL(
        row?.link_url || `/s/n46/news/detail/${encodeURIComponent(newsId)}`,
        NOGIZAKA_NEWS_ORIGIN,
      );
    } catch {
      continue;
    }
    if (href.origin !== NOGIZAKA_NEWS_ORIGIN || !/\/news\/detail\//i.test(href.pathname)) continue;

    seen.add(newsId);
    candidates.push({
      newsId: newsId.slice(0, 100),
      href: href.toString().slice(0, 1_000),
      listTitle: listTitle.slice(0, 500),
    });
  }

  return candidates;
}

function articleTitle(html, fallback) {
  const fromTitle = stripHtml(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const heading = stripHtml(String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const value = heading || fromTitle || String(fallback || '');
  return value
    .replace(/\s*[|｜]\s*ニュース\s*[|｜]\s*乃木坂46公式サイト\s*$/iu, '')
    .replace(/\s*[|｜]\s*乃木坂46公式サイト\s*$/iu, '')
    .trim() || String(fallback || '').trim();
}

function articleContent(html, title) {
  const text = stripHtml(html);
  const titleIndex = title ? text.indexOf(title) : -1;
  let area = titleIndex >= 0 ? text.slice(titleIndex, titleIndex + 24_000) : text.slice(-24_000);
  for (const marker of ['\nPRODUCER', '\n乃木坂46合同会社 所属タレント一覧', '\nFAQ']) {
    const end = area.indexOf(marker);
    if (end >= 0) area = area.slice(0, end);
  }
  return area.trim();
}

export function nogizakaEventName(newsId, title) {
  if (String(newsId || '').trim() === '102280') {
    return '「42ndSG アンダーライブ」セットリスト Stationhead リスニングパーティー';
  }
  return String(title || '乃木坂46 Stationhead')
    .replace(/\s*開催決定[！!。]?\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function nogizakaMonitorState(env) {
  return env.OTHER_DB.prepare(`SELECT last_check_at,last_success_at,last_error
      FROM sh_official_news_monitor_state WHERE id=? LIMIT 1`)
    .bind(NOGIZAKA_MONITOR_STATE_ID)
    .first();
}

async function saveMonitorState(env, values) {
  const now = Date.now();
  await env.OTHER_DB.prepare(`INSERT INTO sh_official_news_monitor_state
      (id,last_check_at,last_success_at,last_error,updated_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        last_check_at=excluded.last_check_at,
        last_success_at=excluded.last_success_at,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at`)
    .bind(
      NOGIZAKA_MONITOR_STATE_ID,
      values.lastCheckAt ?? now,
      values.lastSuccessAt ?? null,
      values.lastError ?? null,
      now,
    )
    .run();
}

async function markMissedAnnouncements(env, cfg, now) {
  await env.OTHER_DB.prepare(`UPDATE ${ANNOUNCEMENTS} SET status='missed',updated_at=?
      WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<?`)
    .bind(now, now - cfg.lateWindowMs)
    .run();
}

async function saveAnnouncement(env, article, scheduledAt, detectedAt) {
  const rawText = String(article.text || '').slice(0, 50_000);
  if (scheduledAt != null) {
    await env.OTHER_DB.prepare(`INSERT INTO ${ANNOUNCEMENTS}
        (news_id,news_url,published_date,title,event_name,scheduled_at,detected_at,updated_at,status,raw_text)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(news_id,scheduled_at) DO UPDATE SET
          news_url=excluded.news_url,published_date=excluded.published_date,
          title=excluded.title,event_name=excluded.event_name,
          updated_at=excluded.updated_at,raw_text=excluded.raw_text,
          status=CASE
            WHEN ${ANNOUNCEMENTS}.status IN ('active','ended') THEN ${ANNOUNCEMENTS}.status
            ELSE 'scheduled'
          END
        WHERE ${ANNOUNCEMENTS}.news_url IS NOT excluded.news_url
           OR ${ANNOUNCEMENTS}.published_date IS NOT excluded.published_date
           OR ${ANNOUNCEMENTS}.title IS NOT excluded.title
           OR ${ANNOUNCEMENTS}.event_name IS NOT excluded.event_name
           OR ${ANNOUNCEMENTS}.raw_text IS NOT excluded.raw_text
           OR ${ANNOUNCEMENTS}.status NOT IN ('scheduled','active','ended')`)
      .bind(
        article.newsId,
        article.href,
        article.publishedDate,
        article.title,
        article.eventName,
        scheduledAt,
        detectedAt,
        detectedAt,
        'scheduled',
        rawText,
      )
      .run();
    return 1;
  }

  const existing = await env.OTHER_DB.prepare(`SELECT id FROM ${ANNOUNCEMENTS}
      WHERE news_id=? AND scheduled_at IS NULL ORDER BY id DESC LIMIT 1`)
    .bind(article.newsId)
    .first();
  if (existing?.id) {
    await env.OTHER_DB.prepare(`UPDATE ${ANNOUNCEMENTS} SET
        news_url=?,published_date=?,title=?,event_name=?,updated_at=?,raw_text=?
        WHERE id=?`)
      .bind(
        article.href,
        article.publishedDate,
        article.title,
        article.eventName,
        detectedAt,
        rawText,
        existing.id,
      )
      .run();
    return 1;
  }

  await env.OTHER_DB.prepare(`INSERT INTO ${ANNOUNCEMENTS}
      (news_id,news_url,published_date,title,event_name,scheduled_at,detected_at,updated_at,status,raw_text)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      article.newsId,
      article.href,
      article.publishedDate,
      article.title,
      article.eventName,
      null,
      detectedAt,
      detectedAt,
      'time_unknown',
      rawText,
    )
    .run();
  return 1;
}

async function recordFailure(env, now, error, event) {
  const state = await nogizakaMonitorState(env).catch(() => null);
  const message = String(error?.message || error).slice(0, 1_000);
  await saveMonitorState(env, {
    lastCheckAt: now,
    lastSuccessAt: state?.last_success_at,
    lastError: message,
  }).catch(() => {});
  console.error(JSON.stringify({ event, source: NOGIZAKA_HANDLE, error: message }));
  return { skipped: true, failed: true, reason: event };
}

export async function nogizakaNewsCheckDue(env, now = Date.now()) {
  if (!env?.OTHER_DB?.prepare) return false;
  const cfg = nogizakaOfficialNewsConfig(env);
  try {
    const state = await nogizakaMonitorState(env);
    const lastCheckAt = Number(state?.last_check_at || 0);
    return !lastCheckAt || now - lastCheckAt >= cfg.checkIntervalMs;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'nogizaka_official_news_check_due_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return true;
  }
}

export async function nogizakaStationProbeDue(env, now = Date.now()) {
  if (!env?.OTHER_DB?.prepare) return false;
  const cfg = nogizakaOfficialNewsConfig(env);
  try {
    const row = await env.OTHER_DB.prepare(`SELECT 1 AS due FROM ${ANNOUNCEMENTS}
        WHERE scheduled_at IS NOT NULL AND (
          (status='scheduled' AND scheduled_at>=? AND scheduled_at<=?) OR status='active'
        )
        LIMIT 1`)
      .bind(now - cfg.lateWindowMs, now + cfg.earlyWindowMs)
      .first();
    return Boolean(row?.due);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) return false;
    console.warn(JSON.stringify({
      event: 'nogizaka_official_news_probe_due_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}

export async function runNogizakaNewsListStage(env, cfg, now, dependencies = {}) {
  const state = await nogizakaMonitorState(env);
  if (Number(state?.last_check_at || 0)
      && now - Number(state.last_check_at) < cfg.checkIntervalMs) {
    return { skipped: true, failed: false, reason: 'not-due', candidates: [] };
  }

  await markMissedAnnouncements(env, cfg, now);
  try {
    const response = await (dependencies.fetch || timedFetch)(NOGIZAKA_NEWS_API_URL, {
      headers: NEWS_API_HEADERS,
    }, cfg.requestTimeoutMs);
    if (!response.ok) throw new Error(`Nogizaka official news API HTTP ${response.status}`);
    const payload = await response.json();
    const candidates = nogizakaNewsApiCandidates(payload, cfg);
    return { skipped: false, failed: false, reason: null, candidates };
  } catch (error) {
    return recordFailure(env, now, error, 'nogizaka_official_news_list_failed');
  }
}

export async function runNogizakaNewsDetailStage(env, cfg, now, candidate, dependencies = {}) {
  try {
    const response = await (dependencies.fetch || timedFetch)(candidate.href, {
      headers: NEWS_HEADERS,
      cf: { cacheEverything: true, cacheTtl: Math.floor(cfg.checkIntervalMs / 1_000) },
    }, cfg.requestTimeoutMs);
    if (!response.ok) {
      throw new Error(`Nogizaka official news detail ${candidate.newsId} HTTP ${response.status}`);
    }
    const html = await response.text();
    const title = articleTitle(html, candidate.listTitle);
    const text = articleContent(html, title);
    if (!/station\s*head/i.test(text)) {
      return { skipped: true, failed: false, reason: 'not-stationhead', saved: 0 };
    }

    const date = publishedDate(text);
    const year = Number(date?.slice(0, 4)) || new Date(now + 9 * 3_600_000).getUTCFullYear();
    const times = scheduleTimes(text, year, date);
    const article = {
      ...candidate,
      title,
      publishedDate: date,
      eventName: nogizakaEventName(candidate.newsId, title),
      text,
    };
    if (!times.length) {
      await saveAnnouncement(env, article, null, now);
      console.warn(JSON.stringify({
        event: 'nogizaka_official_news_time_unknown',
        news_id: candidate.newsId,
        title,
      }));
      return { skipped: false, failed: false, reason: null, saved: 1 };
    }

    for (const scheduledAt of times) {
      await saveAnnouncement(env, article, scheduledAt, now);
      console.log(JSON.stringify({
        event: 'nogizaka_official_news_announcement_saved',
        news_id: candidate.newsId,
        scheduled_at: scheduledAt,
        title,
      }));
    }
    return { skipped: false, failed: false, reason: null, saved: times.length };
  } catch (error) {
    return recordFailure(env, now, error, 'nogizaka_official_news_detail_failed');
  }
}

export async function completeNogizakaNewsCheck(env, now) {
  await saveMonitorState(env, { lastCheckAt: now, lastSuccessAt: now, lastError: null });
  return { skipped: false, failed: false, reason: null };
}

function jstDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp + 9 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

async function materializeEndedReadModels(env, completedAt) {
  const result = await env.OTHER_DB.prepare(`SELECT
      a.id,a.event_name,a.scheduled_at,a.first_broadcast_at,a.last_broadcast_at,a.updated_at
    FROM ${ANNOUNCEMENTS} AS a
    LEFT JOIN sh_official_broadcast_series AS series
      ON series.host_handle=? AND series.event_name=a.event_name
    LEFT JOIN sh_official_broadcast_summary AS summary
      ON summary.host_handle=? AND summary.event_name=a.event_name
    WHERE a.status='ended'
      AND COALESCE(a.first_broadcast_at,a.scheduled_at) IS NOT NULL
      AND a.last_broadcast_at IS NOT NULL
      AND (
        series.event_name IS NULL OR series.refreshed_at<a.updated_at
        OR summary.event_name IS NULL OR summary.ended_at IS NULL OR summary.refreshed_at<a.updated_at
      )
    ORDER BY a.updated_at ASC,a.id ASC LIMIT 5`)
    .bind(NOGIZAKA_HANDLE, NOGIZAKA_HANDLE)
    .all();

  let materialized = 0;
  for (const row of result.results || []) {
    const start = Number(row.first_broadcast_at || row.scheduled_at || 0);
    const end = Number(row.last_broadcast_at || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) continue;
    const refreshedAt = Math.max(Number(completedAt) || Date.now(), Number(row.updated_at) || 0);
    await env.OTHER_DB.batch([
      env.OTHER_DB.prepare(`INSERT INTO sh_official_broadcast_summary(
          host_handle,event_name,started_at,ended_at,started_jst,ended_jst,
          sample_count,listener_avg,listener_min,listener_max,likes_max,distinct_tracks,
          comment_count,session_id,refreshed_at)
        SELECT ?,?,?,?,?,?,
          COUNT(p.listener_count),AVG(p.listener_count),MIN(p.listener_count),MAX(p.listener_count),NULL,NULL,
          (SELECT s.comment_count FROM sh_host_broadcast_sessions AS s
            WHERE s.handle=? AND ABS(s.started_at-?)<=900000
            ORDER BY ABS(s.started_at-?),s.id DESC LIMIT 1),
          (SELECT s.id FROM sh_host_broadcast_sessions AS s
            WHERE s.handle=? AND ABS(s.started_at-?)<=900000
            ORDER BY ABS(s.started_at-?),s.id DESC LIMIT 1),
          ?
        FROM ${PROBES} AS p
        WHERE p.announcement_id=? AND p.is_broadcasting=1
          AND p.listener_count IS NOT NULL AND p.observed_at>=? AND p.observed_at<=?
        ON CONFLICT(host_handle,event_name) DO UPDATE SET
          started_at=excluded.started_at,ended_at=excluded.ended_at,
          started_jst=excluded.started_jst,ended_jst=excluded.ended_jst,
          sample_count=excluded.sample_count,listener_avg=excluded.listener_avg,
          listener_min=excluded.listener_min,listener_max=excluded.listener_max,
          comment_count=COALESCE(excluded.comment_count,sh_official_broadcast_summary.comment_count),
          session_id=COALESCE(excluded.session_id,sh_official_broadcast_summary.session_id),
          refreshed_at=excluded.refreshed_at`)
        .bind(
          NOGIZAKA_HANDLE,
          row.event_name,
          start,
          end,
          jstDateTime(start),
          jstDateTime(end),
          NOGIZAKA_HANDLE,
          start,
          start,
          NOGIZAKA_HANDLE,
          start,
          start,
          refreshedAt,
          row.id,
          start,
          end,
        ),
      env.OTHER_DB.prepare(`INSERT INTO sh_official_broadcast_series(
          host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
        VALUES (?,?,?,COALESCE((
          SELECT json_group_array(json_array(elapsed_minute,listener_count,source_samples))
          FROM (
            SELECT CAST((p.observed_at-?)/60000 AS INTEGER) AS elapsed_minute,
              ROUND(AVG(p.listener_count),1) AS listener_count,COUNT(*) AS source_samples
            FROM ${PROBES} AS p
            WHERE p.announcement_id=? AND p.is_broadcasting=1
              AND p.listener_count IS NOT NULL AND p.observed_at>=? AND p.observed_at<=?
            GROUP BY elapsed_minute ORDER BY elapsed_minute ASC
          )
        ),'[]'),'stationhead-finalized:nogizaka46smej',?)
        ON CONFLICT(host_handle,event_name) DO UPDATE SET
          started_at=excluded.started_at,points_json=excluded.points_json,
          source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at`)
        .bind(
          NOGIZAKA_HANDLE,
          row.event_name,
          start,
          start,
          row.id,
          start,
          end,
          refreshedAt,
        ),
    ]);
    materialized += 1;
  }
  return materialized;
}

export async function reconcileNogizakaOfficialAnnouncements(env, _runStartedAt, completedAt = Date.now()) {
  if (!env?.OTHER_DB?.prepare) return { skipped: true, read_models: 0 };
  try {
    const materialized = await materializeEndedReadModels(env, completedAt);
    return { skipped: false, read_models: materialized };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return { skipped: true, read_models: 0, reason: 'schema-pending' };
    }
    throw error;
  }
}
