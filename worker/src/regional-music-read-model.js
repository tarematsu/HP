import { saveMaterializedActionsR2Response } from './pages-response-r2.js';
import { regionalMusicService } from './regional-music-service-registry.js';
import { REGIONAL_MUSIC_DAILY_SERVICES } from './regional-music-dispatch-plan.js';
import { regionalSnapshotKey, mergeRegionalR2Snapshot } from './regional-music-r2-snapshot.js';
import {
  QQ_JAPAN_HISTORY_INDEX_KEY,
  QQ_JAPAN_HISTORY_VIEW_KEY,
} from './qq-japan-chart-history-view.js';
import { NETEASE_JAPAN_HISTORY_VIEW_KEY } from './netease-japan-chart-history.js';
import { MELON_JPOP_HISTORY_VIEW_KEY } from './melon-jpop-history.js';
import {
  KUGOU_JAPAN_CHART_COVERAGE,
  KUGOU_JAPAN_CHART_HISTORY,
} from './kugou-japan-chart-history.js';

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

  const [artists, tracks, releases, playlists, memberships, services, artistTrackOrders] = await Promise.all([
    all(db, `SELECT
        p.service,p.canonical_artist,p.service_artist_id,p.display_name,p.profile_url,
        d.snapshot_date,d.observed_at,d.followers,d.likes,d.monthly_audience,d.total_views
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
        service,service_release_id,canonical_artist,title,release_type,release_year,release_url,last_seen_at
      FROM regional_music_releases
      ORDER BY service,canonical_artist,release_year DESC,title,service_release_id
      LIMIT 3000`),
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
    all(db, `SELECT o.snapshot_date,o.service,o.canonical_artist,o.service_artist_id,
        o.service_track_id,o.observed_at,o.position,o.rank_source
      FROM regional_music_artist_track_order AS o
      WHERE o.observed_at=(SELECT MAX(x.observed_at) FROM regional_music_artist_track_order AS x
        WHERE x.service=o.service AND x.canonical_artist=o.canonical_artist)
      ORDER BY o.service,o.canonical_artist,o.position LIMIT 10000`),
  ]);

  return { artists, tracks, releases, playlists, memberships, services, artistTrackOrders };
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

function qqPeriodParts(value) {
  const match = String(value || '').match(/^(\d{4})_(\d{1,2})$/);
  return match ? { year:Number(match[1]), week:Number(match[2]) } : null;
}

function compareQqPeriods(left, right) {
  const a = qqPeriodParts(left);
  const b = qqPeriodParts(right);
  if (!a || !b) return String(left || '').localeCompare(String(right || ''));
  return (a.year - b.year) || (a.week - b.week);
}

function qqPeriodThursday(period) {
  const parsed = qqPeriodParts(period);
  if (!parsed) return '';
  const jan4 = new Date(Date.UTC(parsed.year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4.getTime() - jan4Weekday * 24 * 60 * 60 * 1000 + (parsed.week - 1) * 7 * 24 * 60 * 60 * 1000);
  return new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function qqJapanStoredPeriods(index) {
  const weeks = index?.weeks && typeof index.weeks === 'object' ? index.weeks : null;
  if (!weeks) return [];
  return Object.keys(weeks).sort(compareQqPeriods).map((period) => {
    const summary = weeks[period] || {};
    const updateTime = String(summary?.update_time || '').trim();
    const publishedAt = /^\d{4}-\d{2}-\d{2}/.test(updateTime) ? updateTime.slice(0, 10) : qqPeriodThursday(period);
    return { period, published_at:publishedAt };
  });
}

export function qqJapanChartReadModel(view, index = null) {
  const payload = {
    coverage:view?.coverage && typeof view.coverage === 'object' ? view.coverage : {},
    history:Array.isArray(view?.history) ? view.history : [],
  };
  const periods = qqJapanStoredPeriods(index);
  if (periods.length) payload.periods = periods;
  return payload;
}

export function neteaseJapanChartReadModel(view) {
  return {
    coverage:view?.coverage && typeof view.coverage === 'object' ? view.coverage : {},
    periods:Array.isArray(view?.periods) ? view.periods : [],
    history:Array.isArray(view?.history) ? view.history : [],
  };
}

export function melonJpopChartReadModel(view) {
  return {
    coverage:view?.coverage && typeof view.coverage === 'object' ? view.coverage : {},
    periods:Array.isArray(view?.periods) ? view.periods : [],
    history:Array.isArray(view?.history) ? view.history : [],
  };
}

export function regionalMusicReadModelPayload(snapshot, updatedAt = Date.now()) {
  return {
    ok: true,
    updated_at: Number(updatedAt) || Date.now(),
    artists: Array.isArray(snapshot?.artists) ? snapshot.artists : [],
    tracks: Array.isArray(snapshot?.tracks) ? snapshot.tracks : [],
    releases: Array.isArray(snapshot?.releases) ? snapshot.releases : [],
    playlists: Array.isArray(snapshot?.playlists) ? snapshot.playlists : [],
    playlist_memberships: Array.isArray(snapshot?.memberships) ? snapshot.memberships : [],
    artist_track_orders: Array.isArray(snapshot?.artistTrackOrders) ? snapshot.artistTrackOrders : [],
    qq_japan_chart: qqJapanChartReadModel(snapshot?.qqJapanChart, snapshot?.qqJapanChartIndex),
    netease_japan_chart: neteaseJapanChartReadModel(snapshot?.neteaseJapanChart),
    melon_jpop_chart: melonJpopChartReadModel(snapshot?.melonJpopChart),
    kugou_japan_chart: {
      coverage: KUGOU_JAPAN_CHART_COVERAGE,
      history: KUGOU_JAPAN_CHART_HISTORY,
    },
    services: (Array.isArray(snapshot?.services) ? snapshot.services : []).map(normalizedCollectorState),
  };
}

export async function publishRegionalMusicReadModel(env, updatedAt = Date.now(), dependencies = {}) {
  if (typeof env?.PAGES_RESPONSE_R2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is unavailable');
  }
  const load = dependencies.loadReadModel || loadRegionalMusicReadModel;
  const save = dependencies.saveR2Response || saveMaterializedActionsR2Response;
  const snapshot = await load(env?.OTHER_DB);
  let payload = regionalMusicReadModelPayload(snapshot, updatedAt);
  if (typeof env.PAGES_RESPONSE_R2.get === 'function') {
    const [snapshots, qqHistoryView, qqHistoryIndex, neteaseHistoryView, melonHistoryView] = await Promise.all([
      Promise.all(REGIONAL_MUSIC_DAILY_SERVICES.map(async service => {
        const object = await env.PAGES_RESPONSE_R2.get(regionalSnapshotKey(service));
        return object ? object.json() : null;
      })),
      (async () => {
        const object = await env.PAGES_RESPONSE_R2.get(QQ_JAPAN_HISTORY_VIEW_KEY);
        return object ? object.json() : null;
      })(),
      (async () => {
        const object = await env.PAGES_RESPONSE_R2.get(QQ_JAPAN_HISTORY_INDEX_KEY);
        return object ? object.json() : null;
      })(),
      (async () => {
        const object = await env.PAGES_RESPONSE_R2.get(NETEASE_JAPAN_HISTORY_VIEW_KEY);
        return object ? object.json() : null;
      })(),
      (async () => {
        const object = await env.PAGES_RESPONSE_R2.get(MELON_JPOP_HISTORY_VIEW_KEY);
        return object ? object.json() : null;
      })(),
    ]);
    for (const regionalSnapshot of snapshots) payload = mergeRegionalR2Snapshot(payload,regionalSnapshot);
    payload.qq_japan_chart = qqJapanChartReadModel(qqHistoryView, qqHistoryIndex);
    payload.netease_japan_chart = neteaseJapanChartReadModel(neteaseHistoryView);
    payload.melon_jpop_chart = melonJpopChartReadModel(melonHistoryView);
  }
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
    releases: payload.releases.length,
    playlists: payload.playlists.length,
    playlist_memberships: payload.playlist_memberships.length,
    services: payload.services.length,
    qq_japan_chart_entries: payload.qq_japan_chart.history.length,
    kugou_japan_chart_entries: payload.kugou_japan_chart.history.length,
    melon_jpop_chart_entries: payload.melon_jpop_chart.history.length,
  };
}
