import { loadAmazonMusicCanonicalMetadata } from './amazon-music-canonical-metadata.js';
import {
  addAmazonMusicRankChanges,
  labelAmazonMusicVariants,
} from './amazon-music-pipeline.js';
import {
  AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN,
  AMAZON_MUSIC_DEEP_STATE_KEY,
  AMAZON_MUSIC_GROUP_KNOWN_KEY,
  scanAmazonChart,
} from './amazon-music-rank-monitor.js';
import { resolveAmazonMusicTracks } from './amazon-music-track-identity.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const AMAZON_MUSIC_DEEP_BASE_RANK = 100_000;
export const AMAZON_MUSIC_DEEP_TARGET_RANK = 150_000;
export const AMAZON_MUSIC_150K_EXTENSION_STATE_KEY = 'amazon-music/rank-monitor/deep-150k-extension.json';

const AMAZON_MUSIC_READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const AMAZON_MUSIC_PAGES_MODEL_KEY = 'amazon-music';
const AMAZON_MUSIC_ARTIST_ID = 'B08P3RHP1P';
const READ_MODEL_HISTORY_DAYS = 365;
const PACING_BUDGET_MS = 510_000;
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const GROUP_ALIASES = Object.freeze([
  ['櫻坂46', ['櫻坂46', 'Sakurazaka46', 'Sakurazaka 46']],
  ['日向坂46', ['日向坂46', 'Hinatazaka46', 'Hinatazaka 46']],
  ['乃木坂46', ['乃木坂46', 'Nogizaka46', 'Nogizaka 46']],
]);

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

function jstDate(now) {
  const shifted = new Date(Number(now) + 9 * 60 * 60_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function canonicalGroup(artist) {
  const value = text(artist)?.normalize('NFKC').toLowerCase() || '';
  for (const [group, aliases] of GROUP_ALIASES) {
    if (aliases.some((alias) => value.includes(alias.normalize('NFKC').toLowerCase()))) return group;
  }
  return null;
}

function groupTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : []).flatMap((track) => {
    const group = canonicalGroup(track?.artist);
    return group ? [{ ...track, group_name: group }] : [];
  });
}

function groupStateMap(state) {
  const map = new Map();
  for (const item of Array.isArray(state?.tracks) ? state.tracks : []) {
    if (item?.amazon_music_id) map.set(String(item.amazon_music_id), item);
  }
  return map;
}

function rankChange(before, item) {
  if (!before) return { ...item, previous_rank: null, change_type: 'enter' };
  if (Number(before.rank) !== Number(item.rank)) {
    return { ...item, previous_rank: Number(before.rank) || null, change_type: 'move' };
  }
  return null;
}

async function saveGroupChanges(db, observedAt, changes) {
  if (!db?.prepare || !changes.length) return 0;
  const resolved = await resolveAmazonMusicTracks(db, changes, observedAt);
  const statements = changes.map((item, index) => db.prepare(`INSERT OR IGNORE INTO amazon_music_group_rank_history
    (observed_at, group_name, amazon_music_id, track_id, rank, previous_rank, change_type, title, artist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      observedAt,
      item.group_name,
      item.amazon_music_id,
      Number.isSafeInteger(Number(resolved[index]?.trackId)) ? Number(resolved[index].trackId) : null,
      item.rank ?? null,
      item.previous_rank ?? null,
      item.change_type,
      item.title ?? null,
      item.artist ?? null,
    ));
  if (typeof db.batch === 'function') await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return statements.length;
}

function historyPoint(snapshotDate, observedAt, tracks) {
  return {
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower_count: null,
    tracks: tracks.map((track) => ({
      amazon_music_id: track.amazon_music_id,
      track_id: track.track_id ?? null,
      amazon_rank: integer(track.amazon_rank),
    })),
  };
}

async function publishCompleted150k(env, deepState, observedAt) {
  const r2 = env?.PAGES_RESPONSE_R2;
  const previousModel = await getJson(r2, AMAZON_MUSIC_READ_MODEL_KEY);
  const previousTracks = Array.isArray(previousModel?.tracks) ? previousModel.tracks : [];
  const deepTracks = (Array.isArray(deepState?.cycle_tracks) ? deepState.cycle_tracks : [])
    .filter((track) => track?.group_name === '櫻坂46')
    .filter((track) => text(track?.amazon_music_id) && (integer(track?.rank) || 0) > 0);

  const trackIdByAmazonId = new Map();
  if (env?.MINUTE_DB?.prepare && deepTracks.length) {
    const resolved = await resolveAmazonMusicTracks(env.MINUTE_DB, deepTracks, observedAt);
    for (const item of resolved) {
      const id = text(item?.amazon_music_id);
      const trackId = integer(item?.trackId);
      if (id && trackId != null) trackIdByAmazonId.set(id, trackId);
    }
  } else {
    for (const track of previousTracks) {
      const id = text(track?.amazon_music_id);
      const trackId = integer(track?.track_id);
      if (id && trackId != null) trackIdByAmazonId.set(id, trackId);
    }
  }

  const canonicalMetadata = await loadAmazonMusicCanonicalMetadata(
    env?.MINUTE_DB,
    trackIdByAmazonId,
  );
  const byId = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    if (!id) continue;
    byId.set(id, {
      ...track,
      amazon_music_id: id,
      amazon_rank: null,
    });
  }
  for (const track of deepTracks) {
    const id = text(track?.amazon_music_id);
    if (!id) continue;
    const current = byId.get(id) || null;
    const trackId = trackIdByAmazonId.get(id) ?? integer(current?.track_id) ?? null;
    const canonical = trackId == null ? null : canonicalMetadata.get(Number(trackId));
    byId.set(id, {
      amazon_music_id: id,
      track_id: trackId,
      title: canonical?.title || current?.title || text(track?.title) || '曲名不明',
      album: text(track?.album) || current?.album || null,
      image: text(track?.image) || current?.image || null,
      amazon_rank: integer(track?.rank),
    });
  }

  const snapshotDate = jstDate(observedAt);
  const tracks = addAmazonMusicRankChanges(
    labelAmazonMusicVariants([...byId.values()]),
    previousModel?.history,
    snapshotDate,
  ).sort((left, right) => {
    const lr = integer(left?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    const rr = integer(right?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    return lr - rr || String(left?.title || '').localeCompare(String(right?.title || ''), 'ja');
  });
  const history = (Array.isArray(previousModel?.history) ? previousModel.history : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.snapshot_date || '')))
    .filter((item) => item.snapshot_date !== snapshotDate)
    .slice(-(READ_MODEL_HISTORY_DAYS - 1));
  history.push(historyPoint(snapshotDate, observedAt, tracks));

  const model = {
    version: 2,
    source: 'amazon-music-jp-overall-150k',
    artist_id: AMAZON_MUSIC_ARTIST_ID,
    artist_name: '櫻坂46',
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower: null,
    track_count: tracks.length,
    tracks,
    history,
    scan: {
      cycle: integer(deepState?.cycle) || 1,
      scanned_tracks: integer(deepState?.scanned_tracks) || 0,
      target_rank: AMAZON_MUSIC_DEEP_TARGET_RANK,
      complete: Boolean(deepState?.complete),
      exhausted: Boolean(deepState?.exhausted),
    },
  };

  await putJson(r2, AMAZON_MUSIC_READ_MODEL_KEY, model);
  const objectKey = pagesActionsR2ResponseKey(AMAZON_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Amazon Music public read-model key is unavailable');
  await putJson(r2, objectKey, {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 600,
    source_revision: `amazon-music-150k:${model.scan.cycle}:${model.scan.scanned_tracks}:${observedAt}`,
    renderer_revision: 'amazon-music-150k-v1',
    body: JSON.stringify({ ok: true, ...model }),
  });
  return {
    published: true,
    visible_ranked_tracks: tracks.filter((track) => integer(track?.amazon_rank) != null).length,
  };
}

export function amazon150kExtensionPlan(deepState, extensionState = null) {
  const cycle = Math.max(1, integer(deepState?.cycle) || 1);
  const scanned = Math.max(0, integer(deepState?.scanned_tracks) || 0);
  if (!deepState || !deepState.complete || scanned < AMAZON_MUSIC_DEEP_BASE_RANK) {
    return { eligible: false, reason: 'base-scan-not-complete' };
  }
  if (scanned >= AMAZON_MUSIC_DEEP_TARGET_RANK) {
    return { eligible: false, reason: 'target-already-complete' };
  }
  const sameCycle = integer(extensionState?.cycle) === cycle;
  const armed = sameCycle && extensionState?.status === 'armed';
  const active = sameCycle && ['seeking', 'collecting'].includes(String(extensionState?.status || ''));
  if (active) {
    return {
      eligible: true,
      cycle,
      status: extensionState.status,
      seek_scanned_tracks: Math.max(0, integer(extensionState?.seek_scanned_tracks) || 0),
      seek_next_url: text(extensionState?.seek_next_url),
      scanned_tracks: Math.max(AMAZON_MUSIC_DEEP_BASE_RANK, integer(extensionState?.scanned_tracks) || AMAZON_MUSIC_DEEP_BASE_RANK),
      next_url: text(extensionState?.next_url),
    };
  }
  if (armed) {
    return {
      eligible: true,
      cycle,
      status: 'seeking',
      seek_scanned_tracks: Math.max(0, integer(extensionState?.seek_scanned_tracks) || 0),
      seek_next_url: text(extensionState?.seek_next_url),
      scanned_tracks: AMAZON_MUSIC_DEEP_BASE_RANK,
      next_url: null,
    };
  }
  const direct = text(deepState?.next_url);
  return {
    eligible: true,
    cycle,
    status: direct ? 'collecting' : 'seeking',
    seek_scanned_tracks: direct ? AMAZON_MUSIC_DEEP_BASE_RANK : 0,
    seek_next_url: direct,
    scanned_tracks: AMAZON_MUSIC_DEEP_BASE_RANK,
    next_url: direct,
  };
}

export async function captureAmazon150kBoundaryCheckpoint(env, observedAt = Date.now()) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) return { boundary_checkpoint_captured: false };
  const deepState = await getJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY);
  const scanned = Math.max(0, integer(deepState?.scanned_tracks) || 0);
  const nextUrl = text(deepState?.next_url);
  if (!deepState || deepState.complete || scanned <= 0 || scanned >= AMAZON_MUSIC_DEEP_BASE_RANK || !nextUrl) {
    return { boundary_checkpoint_captured: false };
  }
  const existing = await getJson(r2, AMAZON_MUSIC_150K_EXTENSION_STATE_KEY);
  if (integer(existing?.cycle) === integer(deepState?.cycle)
    && ['seeking', 'collecting'].includes(String(existing?.status || ''))) {
    return { boundary_checkpoint_captured: false };
  }
  await putJson(r2, AMAZON_MUSIC_150K_EXTENSION_STATE_KEY, {
    version: 1,
    status: 'armed',
    observed_at: observedAt,
    cycle: Math.max(1, integer(deepState?.cycle) || 1),
    base_rank: AMAZON_MUSIC_DEEP_BASE_RANK,
    target_rank: AMAZON_MUSIC_DEEP_TARGET_RANK,
    seek_scanned_tracks: scanned,
    seek_next_url: nextUrl,
  });
  return {
    boundary_checkpoint_captured: true,
    boundary_checkpoint_rank: scanned,
  };
}

export async function continueAmazon150kExtension(env, observedAt = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  const deepState = await getJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY);
  const previousExtension = await getJson(r2, AMAZON_MUSIC_150K_EXTENSION_STATE_KEY);
  const plan = amazon150kExtensionPlan(deepState, previousExtension);
  if (!plan.eligible) return { handled: false, reason: plan.reason };

  const cycleMap = groupStateMap({ tracks: deepState?.cycle_tracks });
  for (const item of Array.isArray(previousExtension?.cycle_tracks) ? previousExtension.cycle_tracks : []) {
    if (item?.amazon_music_id) cycleMap.set(String(item.amazon_music_id), item);
  }
  const reported = new Set([
    ...(Array.isArray(deepState?.reported_ids) ? deepState.reported_ids : []),
    ...(Array.isArray(previousExtension?.reported_ids) ? previousExtension.reported_ids : []),
  ].map(String));
  const knownState = await getJson(r2, AMAZON_MUSIC_GROUP_KNOWN_KEY);
  const known = groupStateMap(knownState);

  let status = plan.status;
  let seekScanned = plan.seek_scanned_tracks;
  let seekNextUrl = plan.seek_next_url;
  let scannedTracks = plan.scanned_tracks;
  let nextUrl = plan.next_url;
  let exhausted = false;
  let pagesScanned = 0;
  let d1Changes = 0;
  let pagesRemaining = AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN;

  if (status === 'seeking') {
    const seek = await scanAmazonChart(fetchImpl, {
      startRank: seekScanned,
      startUrl: seekNextUrl,
      stopRank: AMAZON_MUSIC_DEEP_BASE_RANK,
      maxPages: pagesRemaining,
      pacingWindowMs: PACING_BUDGET_MS,
    });
    seekScanned = seek.scanned_tracks;
    seekNextUrl = seek.continuation_url;
    pagesScanned += seek.pages_scanned;
    pagesRemaining = Math.max(0, pagesRemaining - seek.pages_scanned);
    if (seek.exhausted && seekScanned < AMAZON_MUSIC_DEEP_BASE_RANK) {
      throw new Error(`Amazon 150k boundary seek exhausted at ${seekScanned}`);
    }
    if (seekScanned >= AMAZON_MUSIC_DEEP_BASE_RANK) {
      if (!seekNextUrl) throw new Error('Amazon 150k boundary continuation URL is missing');
      status = 'collecting';
      scannedTracks = AMAZON_MUSIC_DEEP_BASE_RANK;
      nextUrl = seekNextUrl;
    }
  }

  if (status === 'collecting' && pagesRemaining > 0 && scannedTracks < AMAZON_MUSIC_DEEP_TARGET_RANK) {
    if (!nextUrl) throw new Error('Amazon 150k continuation URL is missing');
    const collectPacingMs = Math.floor(PACING_BUDGET_MS * pagesRemaining / AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN);
    const scan = await scanAmazonChart(fetchImpl, {
      startRank: scannedTracks,
      startUrl: nextUrl,
      stopRank: AMAZON_MUSIC_DEEP_TARGET_RANK,
      maxPages: pagesRemaining,
      pacingWindowMs: collectPacingMs,
    });
    scannedTracks = scan.scanned_tracks;
    nextUrl = scan.continuation_url;
    exhausted = scan.exhausted;
    pagesScanned += scan.pages_scanned;

    const changes = [];
    for (const item of groupTracks(scan.tracks)) {
      const id = String(item.amazon_music_id);
      cycleMap.set(id, item);
      if (reported.has(id)) continue;
      const change = rankChange(known.get(id), item);
      if (change) changes.push(change);
      reported.add(id);
    }
    if (changes.length) d1Changes += await saveGroupChanges(env?.MINUTE_DB, observedAt, changes);
  }

  const complete = scannedTracks >= AMAZON_MUSIC_DEEP_TARGET_RANK || exhausted;
  const cycleTracks = [...cycleMap.values()].sort((left, right) => Number(left.rank) - Number(right.rank));
  const extensionState = {
    version: 1,
    status: complete ? 'complete' : status,
    observed_at: observedAt,
    cycle: plan.cycle,
    base_rank: AMAZON_MUSIC_DEEP_BASE_RANK,
    target_rank: AMAZON_MUSIC_DEEP_TARGET_RANK,
    seek_scanned_tracks: seekScanned,
    seek_next_url: seekNextUrl,
    scanned_tracks: scannedTracks,
    next_url: nextUrl,
    complete,
    exhausted,
    cycle_tracks: cycleTracks,
    reported_ids: [...reported],
  };
  await putJson(r2, AMAZON_MUSIC_150K_EXTENSION_STATE_KEY, extensionState);

  if (!complete) {
    return {
      handled: true,
      ok: true,
      extension: true,
      phase: status,
      scanned_tracks: scannedTracks,
      seek_scanned_tracks: seekScanned,
      pages_scanned: pagesScanned,
      complete: false,
      d1_changes: d1Changes,
    };
  }

  const completedDeepState = {
    observed_at: observedAt,
    cycle: plan.cycle,
    target_rank: AMAZON_MUSIC_DEEP_TARGET_RANK,
    scanned_tracks: scannedTracks,
    // Keep the continuation token even when complete so future target increases
    // can continue without re-seeking from rank 1.
    next_url: nextUrl,
    complete: true,
    exhausted,
    cycle_tracks: cycleTracks,
    reported_ids: [...reported],
  };
  await putJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY, completedDeepState);
  await putJson(r2, AMAZON_MUSIC_GROUP_KNOWN_KEY, {
    observed_at: observedAt,
    cycle: plan.cycle,
    tracks: cycleTracks,
  });
  const pages = await publishCompleted150k(env, completedDeepState, observedAt);

  return {
    handled: true,
    ok: true,
    extension: true,
    phase: 'complete',
    scanned_tracks: scannedTracks,
    seek_scanned_tracks: seekScanned,
    pages_scanned: pagesScanned,
    complete: true,
    exhausted,
    sakamichi_tracks_seen: cycleTracks.length,
    d1_changes: d1Changes,
    pages,
  };
}
