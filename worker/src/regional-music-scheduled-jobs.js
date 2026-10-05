import { collectLatestKugouAcgHistory } from './kugou-acg-chart-history.js';
import { qqAnimeHistoryRecord, qqIsoWeekPeriod, upsertQqAnimeHistoryArtifacts } from './qq-anime-chart-history-view.js';
import { qqJapanHistoryRecord, upsertQqJapanHistoryArtifacts } from './qq-japan-chart-history-view.js';
import { collectKkbox } from './regional-music-kkbox.js';
import { collectKugouMusic } from './regional-music-kugou.js';
import {
  collectQqMusic,
  fetchQqAnimeToplist,
  fetchQqJapanToplist,
  QQ_ANIME_TOPLIST_PLAYLIST_ID,
  QQ_JAPAN_TOPLIST_PLAYLIST_ID,
  saveQqAnimeToplist,
  saveQqJapanToplist,
} from './regional-music-qq.js';
import { publishRegionalMusicReadModel } from './regional-music-read-model.js';
import { collectRegionalR2Snapshot, regionalDayKey, regionalSnapshotKey } from './regional-music-r2-snapshot.js';
import { saveRegionalCollectorState } from './regional-music-store.js';
import {
  KKBOX_WEEKLY_CRON,
  KUGOU_ACG_WEEKLY_CRON,
  KUGOU_WEEKDAY_CRON,
  QQ_TOPLIST_POLL_CRON,
  QQ_WEEKLY_CRON,
} from './scheduled-crons.js';

export {
  KKBOX_WEEKLY_CRON,
  KUGOU_ACG_WEEKLY_CRON,
  KUGOU_WEEKDAY_CRON,
  QQ_TOPLIST_POLL_CRON,
  QQ_WEEKLY_CRON,
};

export const REGIONAL_SCHEDULED_JOB_CRONS = Object.freeze([
  KKBOX_WEEKLY_CRON,
  QQ_WEEKLY_CRON,
  KUGOU_WEEKDAY_CRON,
  KUGOU_ACG_WEEKLY_CRON,
  QQ_TOPLIST_POLL_CRON,
]);

const REGIONAL_COLLECTORS = Object.freeze({
  kkbox: collectKkbox,
  qq_music: collectQqMusic,
  kugou_music: collectKugouMusic,
});

async function loadJson(r2, key) {
  const object = await r2?.get?.(key);
  if (!object) return null;
  try {
    return typeof object.json === 'function' ? await object.json() : JSON.parse(await object.text());
  } catch {
    return null;
  }
}

async function saveJson(r2, key, value) {
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  await r2.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
}

export async function collectRegionalServiceToR2(service, env, observedAt = Date.now(), fetchImpl = fetch) {
  const collector = REGIONAL_COLLECTORS[service];
  if (!collector) throw new Error(`unknown regional music service: ${service}`);
  const previous = await loadJson(env?.PAGES_RESPONSE_R2, regionalSnapshotKey(service));
  const snapshot = await collectRegionalR2Snapshot({
    service,
    collect: collector,
    previous,
    now: observedAt,
    fetchImpl,
    bindings: { MINUTE_DB: env?.MINUTE_DB },
  });
  await saveJson(env.PAGES_RESPONSE_R2, regionalDayKey(service, snapshot.day), snapshot);
  await saveJson(env.PAGES_RESPONSE_R2, regionalSnapshotKey(service), snapshot);
  const published = await publishRegionalMusicReadModel(env, observedAt);
  return { service, snapshot_status: snapshot.state?.status || 'error', snapshot_day: snapshot.day, published };
}

function qqCycleKey(timestamp = Date.now()) {
  const jst = new Date(Number(timestamp) + 9 * 60 * 60_000);
  let daysSinceThursday = (jst.getUTCDay() - 4 + 7) % 7;
  if (daysSinceThursday === 0 && jst.getUTCHours() < 18) daysSinceThursday = 7;
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - daysSinceThursday)).toISOString().slice(0, 10);
}

function fingerprint(entries = []) {
  return [...entries]
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || String(a.track_id).localeCompare(String(b.track_id)))
    .map((row) => `${row.position ?? ''}:${row.track_id ?? ''}`)
    .join('|');
}

function previousToplistState(snapshot, playlistId) {
  const playlist = (snapshot?.playlists || []).find((row) => row.service_playlist_id === playlistId);
  const memberships = (snapshot?.playlist_memberships || [])
    .filter((row) => row.service_playlist_id === playlistId)
    .map((row) => ({ track_id: row.service_track_id, position: row.position }));
  return { provider_update_time: playlist?.provider_update_time ?? null, fingerprint: fingerprint(memberships) };
}

function changed(previous, chart) {
  const nextFingerprint = fingerprint(chart?.entries || []);
  if (!previous?.provider_update_time && !previous?.fingerprint) return true;
  if (chart?.update_time && previous?.provider_update_time && chart.update_time !== previous.provider_update_time) return true;
  return Boolean(nextFingerprint) && nextFingerprint !== previous?.fingerprint;
}

async function collectQqToplistKind(kind, env, observedAt, fetchImpl = fetch) {
  const isJapan = kind === 'japan';
  const markerKey = `regional-music/qq_music/${isJapan ? 'japan' : 'anime'}-toplist-update.json`;
  const cycle = qqCycleKey(observedAt);
  const marker = await loadJson(env.PAGES_RESPONSE_R2, markerKey);
  if (marker?.version === 1 && marker.cycle === cycle && marker.status === 'updated') {
    return { kind, status: 'already_updated', cycle, entries: marker.entries ?? null };
  }

  const previous = await loadJson(env.PAGES_RESPONSE_R2, regionalSnapshotKey('qq_music'));
  const playlistId = isJapan ? QQ_JAPAN_TOPLIST_PLAYLIST_ID : QQ_ANIME_TOPLIST_PLAYLIST_ID;
  const chart = isJapan ? await fetchQqJapanToplist(fetchImpl) : await fetchQqAnimeToplist(fetchImpl);
  if (!changed(previousToplistState(previous, playlistId), chart)) {
    return { kind, status: 'not_updated', cycle, provider_update_time: chart.update_time ?? null, entries: chart.entries.length };
  }

  const collect = async (snapshotEnv) => {
    if (isJapan) await saveQqJapanToplist(snapshotEnv, chart, observedAt);
    else await saveQqAnimeToplist(snapshotEnv, chart, observedAt);
    await saveRegionalCollectorState(snapshotEnv, {
      service: 'qq_music',
      status: 'ok',
      last_attempt_at: observedAt,
      last_success_at: observedAt,
      last_error_class: null,
      last_error_message: null,
      entity_counts: { [isJapan ? 'japan_chart_entries' : 'anime_chart_entries']: chart.entries.length },
      updated_at: observedAt,
    });
  };
  const snapshot = await collectRegionalR2Snapshot({
    service: 'qq_music', collect, previous, now: observedAt, fetchImpl, bindings: { MINUTE_DB: env?.MINUTE_DB },
  });
  if (snapshot.state?.status !== 'ok') throw new Error(snapshot.state?.last_error_message || `QQ ${kind} toplist snapshot failed`);
  await saveJson(env.PAGES_RESPONSE_R2, regionalDayKey('qq_music', snapshot.day), snapshot);
  await saveJson(env.PAGES_RESPONSE_R2, regionalSnapshotKey('qq_music'), snapshot);

  const period = qqIsoWeekPeriod(new Date(`${cycle}T00:00:00Z`));
  const record = isJapan
    ? qqJapanHistoryRecord(period, { ...chart, provider_period: period }, observedAt)
    : qqAnimeHistoryRecord(period, { ...chart, provider_period: period }, observedAt);
  const io = {
    load: (key) => loadJson(env.PAGES_RESPONSE_R2, key),
    save: (key, value) => saveJson(env.PAGES_RESPONSE_R2, key, value),
    record,
    updatedAt: observedAt,
  };
  if (isJapan) await upsertQqJapanHistoryArtifacts(io);
  else await upsertQqAnimeHistoryArtifacts(io);

  await publishRegionalMusicReadModel(env, observedAt);
  const nextMarker = {
    version: 1,
    cycle,
    status: 'updated',
    provider_update_time: chart.update_time ?? null,
    fingerprint: fingerprint(chart.entries),
    entries: chart.entries.length,
    collected_at: observedAt,
    published_at: Date.now(),
  };
  await saveJson(env.PAGES_RESPONSE_R2, markerKey, nextMarker);
  return { kind, status: 'updated', cycle, entries: chart.entries.length };
}

export async function collectQqToplistsToR2(env, observedAt = Date.now(), fetchImpl = fetch) {
  const results = [];
  for (const kind of ['japan', 'anime']) results.push(await collectQqToplistKind(kind, env, observedAt, fetchImpl));
  return results;
}

export async function collectKugouAcgToR2(env, observedAt = Date.now(), fetchImpl = fetch) {
  const result = await collectLatestKugouAcgHistory({
    load: (key) => loadJson(env?.PAGES_RESPONSE_R2, key),
    save: (key, value) => saveJson(env?.PAGES_RESPONSE_R2, key, value),
    fetchImpl,
    now: observedAt,
  });
  if (result.changed) await publishRegionalMusicReadModel(env, observedAt);
  return result;
}

export async function runRegionalScheduledJob(cron, env, observedAt = Date.now(), fetchImpl = fetch) {
  if (cron === KKBOX_WEEKLY_CRON) return collectRegionalServiceToR2('kkbox', env, observedAt, fetchImpl);
  if (cron === QQ_WEEKLY_CRON) return collectRegionalServiceToR2('qq_music', env, observedAt, fetchImpl);
  if (cron === KUGOU_WEEKDAY_CRON) return collectRegionalServiceToR2('kugou_music', env, observedAt, fetchImpl);
  if (cron === KUGOU_ACG_WEEKLY_CRON) return collectKugouAcgToR2(env, observedAt, fetchImpl);
  if (cron === QQ_TOPLIST_POLL_CRON) return collectQqToplistsToR2(env, observedAt, fetchImpl);
  throw new Error(`unsupported regional scheduled cron: ${cron || '(empty)'}`);
}
