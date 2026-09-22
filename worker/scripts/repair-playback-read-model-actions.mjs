import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { trackArtistValue, trackTitleValue } from '../src/track-metadata-quality.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';

function wrangler(database, command, options = {}) {
  const args = [wranglerScript, 'd1', 'execute', database, '--remote', '--yes'];
  if (options.file) args.push('--file', options.file);
  else args.push('--json', '--command', command);
  return execFileSync(process.execPath, args, {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function rows(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  return containers.flatMap((container) => (
    container?.results || container?.result?.results || container?.result?.[0]?.results || []
  ));
}

function query(database, sql) {
  return rows(wrangler(database, sql));
}

function quote(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return `'${String(value).replaceAll('\u0000', '').replaceAll("'", "''")}'`;
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function integer(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeIsrc(value) {
  const normalized = String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return normalized.length === 12 ? normalized : null;
}

function currentModels() {
  return query(factsDatabase, `SELECT channel_id,station_id,start_time,queue_json
    FROM sh_queue_read_model_current
    WHERE queue_json IS NOT NULL`);
}

function queueIdentityRows(stationId, startTime) {
  const station = integer(stationId);
  const start = integer(startTime);
  if (station == null || start == null) return [];
  return query(buddiesDatabase, `SELECT position,queue_track_id,stationhead_track_id,spotify_id,isrc
    FROM sh_queue_items
    WHERE station_id=${quote(station)} AND start_time=${quote(start)}
    ORDER BY position ASC`);
}

function stationheadIdentityRows(ids) {
  if (!ids.length) return [];
  return query(factsDatabase, `SELECT stationhead_track_id,spotify_id,isrc,title,artist
    FROM sh_tracks
    WHERE stationhead_track_id IN (${ids.map(quote).join(',')})
    ORDER BY last_seen_at DESC`);
}

function metadataRows(database, spotifyIds, isrcs) {
  const clauses = [];
  if (spotifyIds.length) clauses.push(`spotify_id IN (${spotifyIds.map(quote).join(',')})`);
  if (isrcs.length) clauses.push(`isrc IN (${isrcs.map(quote).join(',')})`);
  if (!clauses.length) return [];
  return query(database, `SELECT spotify_id,isrc,title,artist,thumbnail_url,fetched_at
    FROM sh_track_metadata
    WHERE ${clauses.join(' OR ')}`);
}

function mergeMetadata(current, incoming) {
  if (!incoming) return current;
  if (!current) return { ...incoming };
  return {
    ...incoming,
    ...current,
    spotify_id: text(current.spotify_id) || text(incoming.spotify_id),
    isrc: normalizeIsrc(current.isrc) || normalizeIsrc(incoming.isrc),
    title: trackTitleValue(current.title) || trackTitleValue(incoming.title),
    artist: trackArtistValue(current.artist) || trackArtistValue(incoming.artist),
    thumbnail_url: text(current.thumbnail_url) || text(incoming.thumbnail_url),
    fetched_at: Math.max(Number(current.fetched_at || 0), Number(incoming.fetched_at || 0)) || null,
  };
}

function buildMetadataMaps(allRows) {
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const row of allRows) {
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizeIsrc(row?.isrc);
    if (spotifyId) bySpotify.set(spotifyId, mergeMetadata(bySpotify.get(spotifyId), row));
    if (isrc) byIsrc.set(isrc, mergeMetadata(byIsrc.get(isrc), row));
  }
  return { bySpotify, byIsrc };
}

function enrichQueueIdentity(identityRows, stationheadRows) {
  const byStationhead = new Map();
  for (const row of stationheadRows) {
    const id = integer(row?.stationhead_track_id);
    if (id == null || byStationhead.has(id)) continue;
    byStationhead.set(id, row);
  }
  return identityRows.map((row) => {
    const source = byStationhead.get(integer(row?.stationhead_track_id));
    if (!source) return row;
    return {
      ...source,
      ...row,
      spotify_id: text(row.spotify_id) || text(source.spotify_id),
      isrc: normalizeIsrc(row.isrc) || normalizeIsrc(source.isrc),
      title: trackTitleValue(row.title) || trackTitleValue(source.title),
      artist: trackArtistValue(row.artist) || trackArtistValue(source.artist),
    };
  });
}

function hydrateTrackArray(tracks, identityByPosition, metadataMaps) {
  if (!Array.isArray(tracks) || !tracks.length) return { tracks, changed: false };
  let changed = false;
  const hydrated = tracks.map((track, index) => {
    if (!track || typeof track !== 'object') return track;
    const position = integer(track.position) ?? index;
    const identity = identityByPosition.get(position);
    const spotifyId = text(track.spotify_id) || text(identity?.spotify_id);
    const isrc = normalizeIsrc(track.isrc) || normalizeIsrc(identity?.isrc);
    const metadata = metadataMaps.bySpotify.get(spotifyId) || metadataMaps.byIsrc.get(isrc) || identity;

    const next = {
      ...track,
      title: trackTitleValue(track.title) || trackTitleValue(metadata?.title),
      artist: trackArtistValue(track.artist) || trackArtistValue(metadata?.artist),
      thumbnail_url: text(track.thumbnail_url) || text(metadata?.thumbnail_url),
    };
    const queueTrackId = integer(track.queue_track_id) ?? integer(identity?.queue_track_id);
    const stationheadTrackId = integer(track.stationhead_track_id) ?? integer(identity?.stationhead_track_id);
    if (queueTrackId != null) next.queue_track_id = queueTrackId;
    if (stationheadTrackId != null) next.stationhead_track_id = stationheadTrackId;
    if (spotifyId) next.spotify_id = spotifyId;
    if (isrc) next.isrc = isrc;

    if (JSON.stringify(next) !== JSON.stringify(track)) changed = true;
    return next;
  });
  return { tracks: hydrated, changed };
}

function hydrateQueue(queue, identityRows, metadataMaps) {
  if (!queue || typeof queue !== 'object') return queue;
  const identityByPosition = new Map();
  for (const row of identityRows) {
    const position = integer(row?.position);
    if (position != null) identityByPosition.set(position, row);
  }

  const materialized = hydrateTrackArray(queue.tracks, identityByPosition, metadataMaps);
  const presentation = hydrateTrackArray(queue.presentation_tracks, identityByPosition, metadataMaps);
  if (!materialized.changed && !presentation.changed) return queue;
  return {
    ...queue,
    ...(Array.isArray(queue.tracks) ? { tracks: materialized.tracks } : {}),
    ...(Array.isArray(queue.presentation_tracks)
      ? { presentation_tracks: presentation.tracks }
      : {}),
  };
}

function collectTrackKeys(tracks, spotifyIds, isrcs) {
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const spotifyId = text(track?.spotify_id);
    const isrc = normalizeIsrc(track?.isrc);
    if (spotifyId) spotifyIds.add(spotifyId);
    if (isrc) isrcs.add(isrc);
  }
}

const models = currentModels();
const prepared = [];
const stationheadIds = new Set();
const spotifyIds = new Set();
const isrcs = new Set();
let identityCount = 0;

for (const model of models) {
  let queue;
  try { queue = JSON.parse(String(model.queue_json || 'null')); } catch { continue; }
  if (!queue || typeof queue !== 'object') continue;
  const identityRows = queueIdentityRows(model.station_id, model.start_time);
  identityCount += identityRows.length;
  for (const row of identityRows) {
    const stationheadTrackId = integer(row.stationhead_track_id);
    const spotifyId = text(row.spotify_id);
    const isrc = normalizeIsrc(row.isrc);
    if (stationheadTrackId != null) stationheadIds.add(stationheadTrackId);
    if (spotifyId) spotifyIds.add(spotifyId);
    if (isrc) isrcs.add(isrc);
  }
  collectTrackKeys(queue.tracks, spotifyIds, isrcs);
  collectTrackKeys(queue.presentation_tracks, spotifyIds, isrcs);
  prepared.push({ model, queue, identityRows });
}

const stationheadRows = stationheadIdentityRows([...stationheadIds]);
for (const row of stationheadRows) {
  const spotifyId = text(row.spotify_id);
  const isrc = normalizeIsrc(row.isrc);
  if (spotifyId) spotifyIds.add(spotifyId);
  if (isrc) isrcs.add(isrc);
}

const metadata = [
  ...metadataRows(buddiesDatabase, [...spotifyIds], [...isrcs]),
  ...metadataRows(factsDatabase, [...spotifyIds], [...isrcs]),
];
const maps = buildMetadataMaps(metadata);
const statements = [];

for (const entry of prepared) {
  const enrichedIdentity = enrichQueueIdentity(entry.identityRows, stationheadRows);
  const hydrated = hydrateQueue(entry.queue, enrichedIdentity, maps);
  if (hydrated === entry.queue) continue;
  statements.push(`UPDATE sh_queue_read_model_current SET queue_json=${quote(JSON.stringify(hydrated))}
    WHERE channel_id=${quote(entry.model.channel_id)};`);
}

if (statements.length) {
  const directory = mkdtempSync(join(workerRoot, '.playback-read-model-actions-'));
  try {
    const path = join(directory, 'apply.sql');
    writeFileSync(path, `${statements.join('\n')}\n`, 'utf8');
    wrangler(factsDatabase, '', { file: path });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  current_models: prepared.length,
  identity_rows: identityCount,
  metadata_rows: metadata.length,
  read_models_repaired: statements.length,
}));
