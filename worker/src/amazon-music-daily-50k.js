import { loadAmazonMusicCanonicalMetadata } from './amazon-music-canonical-metadata.js';
import {
  addAmazonMusicRankChanges,
  labelAmazonMusicVariants,
} from './amazon-music-pipeline.js';
import {
  AMAZON_MUSIC_TOP_STATE_KEY,
  monitorAmazonTop500,
  scanAmazonChart,
} from './amazon-music-rank-monitor.js';
import { recordAmazonTop500Check } from './amazon-music-top500-history.js';
import { resolveAmazonMusicTracks } from './amazon-music-track-identity.js';
import { isAmazonMusicTitleTrack } from './amazon-music-title-tracks.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK = 50_000;
export const AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN = 600;
export const AMAZON_MUSIC_DAILY_SCAN_PACING_WINDOW_MS = 570_000;
export const AMAZON_MUSIC_DAILY_SCAN_STATE_KEY = 'amazon-music/rank-monitor/daily-50k.json';
export const AMAZON_MUSIC_DAILY_SCAN_HISTORY_KEY = 'amazon-music/rank-monitor/daily-50k-history.json';

const AMAZON_MUSIC_READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const AMAZON_MUSIC_PAGES_MODEL_KEY = 'amazon-music';
const READ_MODEL_HISTORY_DAYS = 365;
const SCAN_HISTORY_LIMIT = 200;
const GROUP_NAMES = new Set(['乃木坂46', '櫻坂46', '日向坂46']);
const GROUP_ALIASES = Object.freeze([
  ['櫻坂46', ['櫻坂46', 'Sakurazaka46', 'Sakurazaka 46']],
  ['日向坂46', ['日向坂46', 'Hinatazaka46', 'Hinatazaka 46']],
  ['乃木坂46', ['乃木坂46', 'Nogizaka46', 'Nogizaka 46']],
]);
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function integer(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function jstDate(now) {
  const shifted = new Date(Number(now) + 9 * 60 * 60_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const stored = await r2.get(key);
  if (!stored) return null;
  try {
    if (typeof stored.json === 'function') return await stored.json();
    if (typeof stored.text === 'function') return JSON.parse(await stored.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value) {
  await r2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

function canonicalGroup(artist) {
  const value = text(artist)?.normalize('NFKC').toLowerCase() || '';
  for (const [group, aliases] of GROUP_ALIASES) {
    if (aliases.some((alias) => value.includes(alias.normalize('NFKC').toLowerCase()))) return group;
  }
  return null;
}

function groupTracks(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((track) => {
    const groupName = canonicalGroup(track?.artist);
    if (!groupName) return [];
    return [{ ...track, group_name: groupName }];
  });
}

function cycleMap(state) {
  const result = new Map();
  for (const track of Array.isArray(state?.cycle_tracks) ? state.cycle_tracks : []) {
    const id = text(track?.amazon_music_id);
    if (id) result.set(id, track);
  }
  return result;
}

async function recordScanEvent(r2, entry) {
  const previous = await getJson(r2, AMAZON_MUSIC_DAILY_SCAN_HISTORY_KEY);
  const events = Array.isArray(previous?.events) ? previous.events : [];
  events.push({ version: 1, ...entry });
  const retained = events
    .filter((item) => Number.isFinite(Number(item?.observed_at)))
    .sort((a, b) => Number(a.observed_at) - Number(b.observed_at))
    .slice(-SCAN_HISTORY_LIMIT);
  await putJson(r2, AMAZON_MUSIC_DAILY_SCAN_HISTORY_KEY, {
    version: 1,
    updated_at: Number(entry?.observed_at) || Date.now(),
    events: retained,
  });
  return retained.length;
}

export function shouldRestartAmazonDaily50k(state, currentTop500Hash) {
  const baseline = text(state?.baseline_top500_hash);
  const current = text(currentTop500Hash);
  return Boolean(state?.status === 'active' && baseline && current && baseline !== current);
}

async function observeTop500(env, observedAt, fetchImpl) {
  const result = await monitorAmazonTop500(env, observedAt, fetchImpl);
  await recordAmazonTop500Check(env, observedAt, result);
  const snapshot = await getJson(env?.PAGES_RESPONSE_R2, AMAZON_MUSIC_TOP_STATE_KEY);
  return { ...result, hash: text(snapshot?.hash) };
}

async function resolveTrackIds(db, observedTracks, previousTracks, observedAt) {
  const ids = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    const trackId = integer(track?.track_id);
    if (id && trackId != null) ids.set(id, trackId);
  }
  if (!db?.prepare || !observedTracks.length) return ids;
  const resolved = await resolveAmazonMusicTracks(db, observedTracks, observedAt);
  for (const item of resolved) {
    const id = text(item?.amazon_music_id);
    if (!id) continue;
    const trackId = integer(item?.trackId);
    if (trackId != null) ids.set(id, trackId);
    else ids.delete(id);
  }
  return ids;
}

function historyPoint(snapshotDate, observedAt, tracks) {
  return {
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower_count: null,
    tracks: tracks.map((track) => ({
      amazon_music_id: track.amazon_music_id,
      track_id: track.track_id ?? null,
      group_name: track.group_name ?? null,
      amazon_rank: integer(track.amazon_rank),
    })),
  };
}

async function saveGroupChanges(db, observedAt, previousTracks, currentTracks) {
  if (!db?.prepare) return 0;
  const previous = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    const rank = integer(track?.amazon_rank);
    const groupName = text(track?.group_name);
    if (id && rank != null && groupName) previous.set(id, { ...track, amazon_music_id: id, amazon_rank: rank, group_name: groupName });
  }
  const changes = [];
  const currentIds = new Set();
  for (const track of currentTracks) {
    const id = text(track?.amazon_music_id);
    const rank = integer(track?.amazon_rank);
    if (!id || rank == null) continue;
    currentIds.add(id);
    const before = previous.get(id);
    if (!before || integer(before.amazon_rank) !== rank) {
      changes.push({
        ...track,
        previous_rank: before ? integer(before.amazon_rank) : null,
        change_type: before ? 'move' : 'enter',
      });
    }
  }
  for (const [id, before] of previous) {
    if (currentIds.has(id)) continue;
    changes.push({
      ...before,
      amazon_music_id: id,
      amazon_rank: null,
      previous_rank: integer(before.amazon_rank),
      change_type: 'exit',
    });
  }
  if (!changes.length) return 0;
  const resolved = await resolveAmazonMusicTracks(db, changes, observedAt);
  const statements = changes.map((item, index) => db.prepare(`INSERT OR IGNORE INTO amazon_music_group_rank_history
    (observed_at, group_name, amazon_music_id, track_id, rank, previous_rank, change_type, title, artist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      observedAt,
      item.group_name,
      item.amazon_music_id,
      integer(resolved[index]?.trackId),
      integer(item.amazon_rank),
      integer(item.previous_rank),
      item.change_type,
      item.title ?? null,
      item.artist ?? item.group_name ?? null,
    ));
  if (typeof db.batch === 'function') await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return statements.length;
}

async function publishCompletedScan(env, state, observedAt) {
  const r2 = env?.PAGES_RESPONSE_R2;
  const previousModel = await getJson(r2, AMAZON_MUSIC_READ_MODEL_KEY);
  const previousTracks = Array.isArray(previousModel?.tracks) ? previousModel.tracks : [];
  const observedTracks = [...cycleMap(state).values()]
    .filter((track) => GROUP_NAMES.has(text(track?.group_name)))
    .filter((track) => text(track?.amazon_music_id) && integer(track?.rank) != null);
  const trackIdByAmazonId = await resolveTrackIds(env?.MINUTE_DB, observedTracks, previousTracks, observedAt);
  const canonicalMetadata = await loadAmazonMusicCanonicalMetadata(env?.MINUTE_DB, trackIdByAmazonId);

  const byId = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    const groupName = text(track?.group_name);
    if (!id || !GROUP_NAMES.has(groupName)) continue;
    byId.set(id, {
      ...track,
      amazon_music_id: id,
      group_name: groupName,
      amazon_rank: null,
    });
  }

  for (const track of observedTracks) {
    const id = text(track?.amazon_music_id);
    if (!id) continue;
    const current = byId.get(id) || null;
    const trackId = trackIdByAmazonId.get(id) ?? integer(current?.track_id) ?? null;
    const canonical = trackId == null ? null : canonicalMetadata.get(Number(trackId));
    const next = {
      amazon_music_id: id,
      track_id: trackId,
      group_name: text(track?.group_name) || current?.group_name || null,
      title: canonical?.title || current?.title || text(track?.title) || '曲名不明',
      album: text(track?.album) || current?.album || null,
      image: text(track?.image) || current?.image || null,
      amazon_rank: integer(track?.rank),
    };
    byId.set(id, { ...next, is_title_track: isAmazonMusicTitleTrack(next) });
  }

  const snapshotDate = jstDate(observedAt);
  const tracks = addAmazonMusicRankChanges(
    labelAmazonMusicVariants([...byId.values()]),
    previousModel?.history,
    snapshotDate,
  ).sort((left, right) => {
    const lr = integer(left?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    const rr = integer(right?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    return lr - rr
      || String(left?.group_name || '').localeCompare(String(right?.group_name || ''), 'ja')
      || String(left?.title || '').localeCompare(String(right?.title || ''), 'ja');
  });

  const history = (Array.isArray(previousModel?.history) ? previousModel.history : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.snapshot_date || '')))
    .filter((item) => item.snapshot_date !== snapshotDate)
    .slice(-(READ_MODEL_HISTORY_DAYS - 1));
  history.push(historyPoint(snapshotDate, observedAt, tracks));

  const model = {
    version: 4,
    source: 'amazon-music-jp-overall-50k-sakamichi',
    artist_id: null,
    artist_name: '坂道3グループ',
    artists: ['乃木坂46', '櫻坂46', '日向坂46'],
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower: null,
    track_count: tracks.length,
    tracks,
    history,
    scan: {
      scan_id: state.scan_id,
      scanned_tracks: integer(state.scanned_tracks) || 0,
      target_rank: AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK,
      complete: true,
      exhausted: Boolean(state.exhausted),
      restarts: integer(state.restarts) || 0,
    },
  };

  await saveGroupChanges(env?.MINUTE_DB, observedAt, previousTracks, tracks);
  await putJson(r2, AMAZON_MUSIC_READ_MODEL_KEY, model);
  const objectKey = pagesActionsR2ResponseKey(AMAZON_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Amazon Music public read-model key is unavailable');
  await putJson(r2, objectKey, {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 86_400,
    source_revision: `amazon-music-50k:${state.scan_id}:${state.scanned_tracks}:${observedAt}`,
    renderer_revision: 'amazon-music-50k-v1',
    body: JSON.stringify({ ok: true, ...model }),
  });
  return { published: true, tracks: tracks.length, ranked_tracks: tracks.filter((track) => integer(track?.amazon_rank) != null).length };
}

function freshState({ observedAt, topHash, previous, reason }) {
  const restarts = reason === 'top-500-update'
    ? Math.max(0, integer(previous?.restarts) || 0) + 1
    : 0;
  return {
    version: 1,
    status: 'active',
    scan_id: `${Number(observedAt) || Date.now()}${restarts ? `-r${restarts}` : ''}`,
    snapshot_date: jstDate(observedAt),
    started_at: observedAt,
    updated_at: observedAt,
    baseline_top500_hash: text(topHash),
    scanned_tracks: 0,
    next_url: null,
    complete: false,
    exhausted: false,
    cycle_tracks: [],
    restarts,
    start_reason: reason,
  };
}

export async function startAmazonDaily50kScan(env, observedAt = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  const previous = await getJson(r2, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY);
  const top = await observeTop500(env, observedAt, fetchImpl);
  const state = freshState({ observedAt, topHash: top.hash, previous, reason: 'daily-02-jst' });
  await putJson(r2, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY, state);
  await recordScanEvent(r2, {
    event: 'started',
    observed_at: observedAt,
    scan_id: state.scan_id,
    reason: 'daily-02-jst',
    target_rank: AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK,
    pages_per_run: AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN,
    replaced_scan_id: previous?.status === 'active' ? text(previous?.scan_id) : null,
    replaced_scanned_tracks: previous?.status === 'active' ? integer(previous?.scanned_tracks) : null,
  });
  return continueAmazonDaily50kScan(env, observedAt, fetchImpl, { skipTop500Check: true });
}

export async function continueAmazonDaily50kScan(
  env,
  observedAt = Date.now(),
  fetchImpl = fetch,
  { skipTop500Check = false } = {},
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  let state = await getJson(r2, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY);
  if (!state || state.status !== 'active') {
    return { ok: true, skipped: true, reason: 'no-active-daily-50k-scan' };
  }

  if (!skipTop500Check) {
    const top = await observeTop500(env, observedAt, fetchImpl);
    if (shouldRestartAmazonDaily50k(state, top.hash)) {
      const abandoned = state;
      state = freshState({ observedAt, topHash: top.hash, previous: state, reason: 'top-500-update' });
      await putJson(r2, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY, state);
      await recordScanEvent(r2, {
        event: 'restarted',
        observed_at: observedAt,
        scan_id: state.scan_id,
        reason: 'top-500-update',
        changed_positions: Number(top.changed_positions) || 0,
        abandoned_scan_id: text(abandoned?.scan_id),
        abandoned_scanned_tracks: integer(abandoned?.scanned_tracks) || 0,
        target_rank: AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK,
        pages_per_run: AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN,
      });
    }
  }

  const startRank = Math.max(0, integer(state.scanned_tracks) || 0);
  const startUrl = startRank > 0 ? text(state.next_url) : null;
  if (startRank > 0 && !startUrl) throw new Error('Amazon 50k continuation URL is missing');
  const scan = await scanAmazonChart(fetchImpl, {
    startRank,
    startUrl,
    stopRank: AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK,
    maxPages: AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN,
    pacingWindowMs: AMAZON_MUSIC_DAILY_SCAN_PACING_WINDOW_MS,
  });

  const tracks = cycleMap(state);
  for (const track of groupTracks(scan.tracks)) {
    const id = text(track?.amazon_music_id);
    if (id) tracks.set(id, track);
  }
  const complete = scan.scanned_tracks >= AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK || scan.exhausted;
  state = {
    ...state,
    updated_at: observedAt,
    scanned_tracks: scan.scanned_tracks,
    next_url: complete ? null : scan.continuation_url,
    complete,
    exhausted: scan.exhausted,
    cycle_tracks: [...tracks.values()].sort((a, b) => Number(a.rank) - Number(b.rank)),
    status: complete ? 'complete' : 'active',
  };
  await putJson(r2, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY, state);

  let published = null;
  if (complete) {
    published = await publishCompletedScan(env, state, observedAt);
    await recordScanEvent(r2, {
      event: 'completed',
      observed_at: observedAt,
      scan_id: state.scan_id,
      scanned_tracks: state.scanned_tracks,
      target_rank: AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK,
      exhausted: Boolean(state.exhausted),
      restarts: integer(state.restarts) || 0,
    });
  }

  return {
    ok: true,
    skipped: false,
    scan_id: state.scan_id,
    scanned_tracks: state.scanned_tracks,
    pages_scanned: scan.pages_scanned,
    complete,
    exhausted: scan.exhausted,
    restarts: integer(state.restarts) || 0,
    published,
  };
}
