import { saveMaterializedR2Response } from './pages-response-r2.js';
import { loadMaterializedResponse } from './pages-response-store.js';
import {
  REGIONAL_MUSIC_SERVICES as MUSIC_SERVICE_DEFINITIONS,
  regionalMusicService as musicServiceDefinition,
} from './regional-music-service-registry.js';
import {
  regionalSnapshotKey as collectorSnapshotKey,
  mergeRegionalR2Snapshot as mergeCollectorR2Snapshot,
} from './regional-music-r2-snapshot.js';
import {
  QQ_JAPAN_HISTORY_INDEX_KEY,
  QQ_JAPAN_HISTORY_VIEW_KEY,
} from './qq-japan-chart-history-view.js';
import {
  QQ_ANIME_HISTORY_INDEX_KEY,
  QQ_ANIME_HISTORY_VIEW_KEY,
} from './qq-anime-chart-history-view.js';
import { KKBOX_JAPANESE_HISTORY_VIEW_KEY } from './kkbox-japanese-chart-history.js';
import {
  KUGOU_JAPAN_CHART_COVERAGE,
  KUGOU_JAPAN_CHART_HISTORY,
} from './kugou-japan-chart-history.js';
import {
  KUGOU_ACG_HISTORY_INDEX_KEY,
  KUGOU_ACG_HISTORY_VIEW_KEY,
} from './kugou-acg-chart-history.js';

export const MUSIC_SERVICE_READ_MODEL_PREFIX = 'music-service:';
export const MUSIC_SERVICE_READ_MODEL_VERSION = 1;
export const MUSIC_SERVICE_READ_MODEL_CADENCE_SECONDS = 24 * 60 * 60;
export const MUSIC_SERVICE_READ_MODEL_SERVICES = Object.freeze(Object.keys(MUSIC_SERVICE_DEFINITIONS));

const LEGACY_MUSIC_SERVICE_READ_MODEL_PREFIX = 'regional-music:';
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

async function boundAll(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).all();
  return rows(result);
}

function positiveTime(value) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? time : 0;
}

function maximumTime(values) {
  return Math.max(0, ...values.map(positiveTime));
}

function rowSourceTime(row) {
  return maximumTime([
    row?.updated_at,
    row?.observed_at,
    row?.last_attempt_at,
    row?.last_success_at,
    row?.last_seen_at,
    row?.provider_updated_at,
  ]);
}

export function musicServiceReadModelKey(service) {
  const serviceId = String(service || '').trim();
  if (!musicServiceDefinition(serviceId)) throw new Error(`unknown music service: ${serviceId || '(empty)'}`);
  return `${MUSIC_SERVICE_READ_MODEL_PREFIX}${serviceId}`;
}

export async function loadMusicServicesReadModel(db) {
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

export async function loadMusicServiceReadModel(db, service) {
  if (typeof db?.prepare !== 'function') throw new Error('OTHER_DB binding is unavailable');
  const serviceId = String(service || '').trim();
  if (!musicServiceDefinition(serviceId)) throw new Error(`unknown music service: ${serviceId || '(empty)'}`);

  const [artists, tracks, releases, playlists, memberships, services, artistTrackOrders] = await Promise.all([
    boundAll(db, `SELECT
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
      WHERE p.service=?
      ORDER BY p.canonical_artist`, serviceId),
    boundAll(db, `SELECT
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
      WHERE t.service=?
      ORDER BY t.canonical_artist,t.title,t.service_track_id
      LIMIT 5000`, serviceId),
    boundAll(db, `SELECT
        service,service_release_id,canonical_artist,title,release_type,release_year,release_url,last_seen_at
      FROM regional_music_releases
      WHERE service=?
      ORDER BY canonical_artist,release_year DESC,title,service_release_id
      LIMIT 3000`, serviceId),
    boundAll(db, `SELECT
        service,service_playlist_id,playlist_name,playlist_url,playlist_type,owner_name,last_seen_at
      FROM regional_music_playlists
      WHERE service=?
      ORDER BY playlist_name,service_playlist_id
      LIMIT 2000`, serviceId),
    boundAll(db, `SELECT
        m.service,m.service_playlist_id,m.service_track_id,m.snapshot_date,m.observed_at,m.position
      FROM regional_music_playlist_memberships AS m
      INNER JOIN regional_music_playlist_snapshots AS s
        ON s.service=m.service
       AND s.service_playlist_id=m.service_playlist_id
       AND s.snapshot_date=m.snapshot_date
      WHERE m.service=?
        AND s.snapshot_date=(
          SELECT MAX(x.snapshot_date)
          FROM regional_music_playlist_snapshots AS x
          WHERE x.service=s.service
            AND x.service_playlist_id=s.service_playlist_id
        )
      ORDER BY m.service_playlist_id,m.position,m.service_track_id
      LIMIT 10000`, serviceId),
    boundAll(db, `SELECT
        service,status,last_attempt_at,last_success_at,last_error_class,last_error_message,
        entity_counts_json,updated_at
      FROM regional_music_collector_state
      WHERE service=?`, serviceId),
    boundAll(db, `SELECT o.snapshot_date,o.service,o.canonical_artist,o.service_artist_id,
        o.service_track_id,o.observed_at,o.position,o.rank_source
      FROM regional_music_artist_track_order AS o
      WHERE o.service=?
        AND o.observed_at=(SELECT MAX(x.observed_at) FROM regional_music_artist_track_order AS x
          WHERE x.service=o.service AND x.canonical_artist=o.canonical_artist)
      ORDER BY o.canonical_artist,o.position LIMIT 10000`, serviceId),
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
  const definition = musicServiceDefinition(service);
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
    const updateTime = String(summary?.update_time || summary?.published_at || '').trim();
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

export function qqAnimeChartReadModel(view, index = null) {
  return qqJapanChartReadModel(view, index);
}

export function chartHistoryReadModel(view) {
  return {
    coverage:view?.coverage && typeof view.coverage === 'object' ? view.coverage : {},
    periods:Array.isArray(view?.periods) ? view.periods : [],
    history:Array.isArray(view?.history) ? view.history : [],
  };
}

function serviceRows(value, service) {
  return (Array.isArray(value) ? value : []).filter((row) => row?.service === service);
}

export function musicServiceSnapshot(snapshot, service) {
  const serviceId = String(service || '').trim();
  if (!musicServiceDefinition(serviceId)) throw new Error(`unknown music service: ${serviceId || '(empty)'}`);
  return {
    artists:serviceRows(snapshot?.artists, serviceId),
    tracks:serviceRows(snapshot?.tracks, serviceId),
    releases:serviceRows(snapshot?.releases, serviceId),
    playlists:serviceRows(snapshot?.playlists, serviceId),
    memberships:serviceRows(snapshot?.memberships, serviceId),
    services:serviceRows(snapshot?.services, serviceId),
    artistTrackOrders:serviceRows(snapshot?.artistTrackOrders, serviceId),
  };
}

function scopedSourceUpdatedAt(scoped) {
  return maximumTime([
    ...scoped.artists.map(rowSourceTime),
    ...scoped.tracks.map(rowSourceTime),
    ...scoped.releases.map(rowSourceTime),
    ...scoped.playlists.map(rowSourceTime),
    ...scoped.memberships.map(rowSourceTime),
    ...scoped.services.map(rowSourceTime),
    ...scoped.artistTrackOrders.map(rowSourceTime),
  ]);
}

export function musicServiceReadModelPayload(snapshot, service, updatedAt = Date.now()) {
  const serviceId = String(service || '').trim();
  const scoped = musicServiceSnapshot(snapshot, serviceId);
  const payload = {
    ok:true,
    read_model_version:MUSIC_SERVICE_READ_MODEL_VERSION,
    service:serviceId,
    updated_at:Number(updatedAt) || Date.now(),
    source_updated_at:scopedSourceUpdatedAt(scoped),
    artists:scoped.artists,
    tracks:scoped.tracks,
    releases:scoped.releases,
    playlists:scoped.playlists,
    playlist_memberships:scoped.memberships,
    artist_track_orders:scoped.artistTrackOrders,
    services:scoped.services.map(normalizedCollectorState),
  };
  if (serviceId === 'qq_music') {
    payload.qq_japan_chart = qqJapanChartReadModel(snapshot?.qqJapanChart, snapshot?.qqJapanChartIndex);
    payload.qq_anime_chart = qqAnimeChartReadModel(snapshot?.qqAnimeChart, snapshot?.qqAnimeChartIndex);
  }
  if (serviceId === 'kkbox') payload.kkbox_japanese_chart = chartHistoryReadModel(snapshot?.kkboxJapaneseChart);
  if (serviceId === 'kugou_music') {
    payload.kugou_japan_chart = {
      coverage:KUGOU_JAPAN_CHART_COVERAGE,
      history:KUGOU_JAPAN_CHART_HISTORY,
    };
    payload.kugou_acg_chart = qqJapanChartReadModel(snapshot?.kugouAcgChart, snapshot?.kugouAcgChartIndex);
  }
  return payload;
}

export function musicServicesReadModelPayload(snapshot, updatedAt = Date.now()) {
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
    qq_anime_chart: qqAnimeChartReadModel(snapshot?.qqAnimeChart, snapshot?.qqAnimeChartIndex),
    kkbox_japanese_chart: chartHistoryReadModel(snapshot?.kkboxJapaneseChart),
    kugou_japan_chart: {
      coverage: KUGOU_JAPAN_CHART_COVERAGE,
      history: KUGOU_JAPAN_CHART_HISTORY,
    },
    kugou_acg_chart: qqJapanChartReadModel(snapshot?.kugouAcgChart, snapshot?.kugouAcgChartIndex),
    services: (Array.isArray(snapshot?.services) ? snapshot.services : []).map(normalizedCollectorState),
  };
}

async function r2Json(r2, key) {
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

async function materializedPayloadAtKey(r2, modelKey, serviceId) {
  const response = await loadMaterializedResponse(r2, modelKey);
  if (!response?.ok) return null;
  try {
    const payload = await response.json();
    if (!payload || payload.service !== serviceId) return null;
    return { response, payload };
  } catch {
    return null;
  }
}

async function existingMaterializedPayload(r2, modelKey) {
  const serviceId = modelKey.startsWith(MUSIC_SERVICE_READ_MODEL_PREFIX)
    ? modelKey.slice(MUSIC_SERVICE_READ_MODEL_PREFIX.length)
    : '';
  if (!serviceId) return null;
  const current = await materializedPayloadAtKey(r2, modelKey, serviceId);
  if (current) return current;
  return materializedPayloadAtKey(r2, `${LEGACY_MUSIC_SERVICE_READ_MODEL_PREFIX}${serviceId}`, serviceId);
}

function usableCollectorSnapshot(snapshot, service) {
  return Number(snapshot?.version) === 1
    && snapshot?.service === service
    && positiveTime(snapshot?.updated_at) > 0
    && snapshot?.state?.service === service
    && Array.isArray(snapshot?.tracks);
}

async function hydrateServicePayload(env, baseSnapshot, service, generatedAt, providedCollectorSnapshot = undefined) {
  const serviceId = String(service || '').trim();
  const r2 = env?.PAGES_RESPONSE_R2;
  const collectorSnapshot = providedCollectorSnapshot === undefined && typeof r2?.get === 'function'
    ? await r2Json(r2, collectorSnapshotKey(serviceId))
    : providedCollectorSnapshot;
  const hasCollectorSnapshot = usableCollectorSnapshot(collectorSnapshot, serviceId);
  let payload = musicServiceReadModelPayload(hasCollectorSnapshot ? {} : (baseSnapshot || {}), serviceId, generatedAt);

  if (hasCollectorSnapshot) payload = mergeCollectorR2Snapshot(payload, collectorSnapshot);
  payload.read_model_version = MUSIC_SERVICE_READ_MODEL_VERSION;
  payload.service = serviceId;
  const extraTimes = [hasCollectorSnapshot ? collectorSnapshot.updated_at : null];

  if (typeof r2?.get === 'function') {
    if (serviceId === 'qq_music') {
      const [japanView, japanIndex, animeView, animeIndex] = await Promise.all([
        r2Json(r2, QQ_JAPAN_HISTORY_VIEW_KEY),
        r2Json(r2, QQ_JAPAN_HISTORY_INDEX_KEY),
        r2Json(r2, QQ_ANIME_HISTORY_VIEW_KEY),
        r2Json(r2, QQ_ANIME_HISTORY_INDEX_KEY),
      ]);
      payload.qq_japan_chart = qqJapanChartReadModel(japanView, japanIndex);
      payload.qq_anime_chart = qqAnimeChartReadModel(animeView, animeIndex);
      extraTimes.push(japanView?.updated_at, japanIndex?.updated_at, animeView?.updated_at, animeIndex?.updated_at);
    } else if (serviceId === 'kkbox') {
      const view = await r2Json(r2, KKBOX_JAPANESE_HISTORY_VIEW_KEY);
      payload.kkbox_japanese_chart = chartHistoryReadModel(view);
      extraTimes.push(view?.updated_at);
    } else if (serviceId === 'kugou_music') {
      const [acgView, acgIndex] = await Promise.all([
        r2Json(r2, KUGOU_ACG_HISTORY_VIEW_KEY),
        r2Json(r2, KUGOU_ACG_HISTORY_INDEX_KEY),
      ]);
      payload.kugou_acg_chart = qqJapanChartReadModel(acgView, acgIndex);
      extraTimes.push(acgView?.updated_at, acgIndex?.updated_at);
    }
  }

  payload.source_updated_at = maximumTime([payload.source_updated_at, ...extraTimes]);
  payload.updated_at = Number(generatedAt) || Date.now();
  return payload;
}

function unchangedReadModel(existing, payload) {
  return existing?.payload?.read_model_version === MUSIC_SERVICE_READ_MODEL_VERSION
    && Number(existing.payload.source_updated_at || 0) === Number(payload.source_updated_at || 0);
}

export async function publishMusicServiceReadModels(
  env,
  services = MUSIC_SERVICE_READ_MODEL_SERVICES,
  updatedAt = Date.now(),
  dependencies = {},
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is unavailable');

  const selected = [...new Set((services || []).map((value) => String(value || '').trim()).filter(Boolean))];
  for (const service of selected) musicServiceReadModelKey(service);
  if (!selected.length) return { storage:'r2-split', models:0, written:0, skipped:0, results:[] };

  const save = dependencies.saveR2Response || saveMaterializedR2Response;
  const collectorSnapshots = new Map();
  if (typeof r2.get === 'function') {
    await Promise.all(selected.map(async (service) => {
      collectorSnapshots.set(service, await r2Json(r2, collectorSnapshotKey(service)));
    }));
  }

  const missingServices = selected.filter((service) => !usableCollectorSnapshot(collectorSnapshots.get(service), service));
  const fallbackSnapshots = new Map();
  let aggregateSnapshot = null;

  if (missingServices.length) {
    if (typeof dependencies.loadServiceReadModel === 'function') {
      await Promise.all(missingServices.map(async (service) => {
        fallbackSnapshots.set(service, await dependencies.loadServiceReadModel(env?.OTHER_DB, service));
      }));
    } else if (typeof dependencies.loadReadModel === 'function') {
      aggregateSnapshot = await dependencies.loadReadModel(env?.OTHER_DB);
    } else {
      await Promise.all(missingServices.map(async (service) => {
        fallbackSnapshots.set(service, await loadMusicServiceReadModel(env?.OTHER_DB, service));
      }));
    }
  }

  const results = [];
  for (const service of selected) {
    const modelKey = musicServiceReadModelKey(service);
    const baseSnapshot = fallbackSnapshots.get(service) || aggregateSnapshot;
    const payload = await hydrateServicePayload(
      env,
      baseSnapshot,
      service,
      updatedAt,
      collectorSnapshots.get(service),
    );
    const existing = typeof r2.get === 'function'
      ? await existingMaterializedPayload(r2, modelKey)
      : null;

    if (unchangedReadModel(existing, payload)) {
      results.push({
        service,
        model_key:modelKey,
        updated_at:Number(existing.payload.updated_at)
          || Number(existing.response?.headers?.get('x-materialized-at'))
          || 0,
        source_updated_at:payload.source_updated_at,
        skipped:true,
        artists:existing.payload.artists?.length || 0,
        tracks:existing.payload.tracks?.length || 0,
        releases:existing.payload.releases?.length || 0,
        playlists:existing.payload.playlists?.length || 0,
        playlist_memberships:existing.payload.playlist_memberships?.length || 0,
      });
      continue;
    }

    const body = JSON.stringify(payload);
    const saved = await save(
      r2,
      modelKey,
      body,
      200,
      JSON_HEADERS,
      payload.updated_at,
      MUSIC_SERVICE_READ_MODEL_CADENCE_SECONDS,
    );
    if (!saved) throw new Error(`music service R2 read model write failed: ${service}`);
    results.push({
      service,
      model_key:modelKey,
      updated_at:payload.updated_at,
      source_updated_at:payload.source_updated_at,
      skipped:false,
      ...saved,
      artists:payload.artists.length,
      tracks:payload.tracks.length,
      releases:payload.releases.length,
      playlists:payload.playlists.length,
      playlist_memberships:payload.playlist_memberships.length,
    });
  }

  const written = results.filter((row) => !row.skipped).length;
  return {
    storage:'r2-split',
    models:results.length,
    written,
    skipped:results.length - written,
    d1_fallback:missingServices.length > 0,
    d1_fallback_services:missingServices,
    results,
  };
}

export async function publishMusicServiceReadModel(env, service, updatedAt = Date.now(), dependencies = {}) {
  const published = await publishMusicServiceReadModels(env, [service], updatedAt, dependencies);
  return published.results[0] || null;
}

export function publishAllMusicServiceReadModels(env, updatedAt = Date.now(), dependencies = {}) {
  return publishMusicServiceReadModels(env, MUSIC_SERVICE_READ_MODEL_SERVICES, updatedAt, dependencies);
}
