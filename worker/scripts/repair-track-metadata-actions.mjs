import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const candidateLimit = bounded(process.env.TRACK_METADATA_ACTIONS_LIMIT, 100, 1, 500);
const lookbackMs = bounded(process.env.TRACK_METADATA_LOOKBACK_MS, 7 * 24 * 60 * 60_000, 60_000, 30 * 24 * 60 * 60_000);
const refreshMs = bounded(process.env.TRACK_METADATA_REFRESH_MS, 24 * 60 * 60_000, 60_000, 30 * 24 * 60 * 60_000);
const fetchConcurrency = bounded(process.env.TRACK_METADATA_FETCH_CONCURRENCY, 4, 1, 8);
const now = Date.now();

function bounded(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

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

function normalizeIsrc(value) {
  const normalized = String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return normalized.length === 12 ? normalized : null;
}

function complete(row) {
  const spotifyId = text(row?.spotify_id);
  const title = text(row?.title);
  const artist = text(row?.artist);
  return Boolean(spotifyId && title && artist && title !== spotifyId && artist !== spotifyId && !/^JP[A-Z0-9]{8,}$/i.test(artist));
}

function candidateRows() {
  const cutoff = now - lookbackMs;
  return query(buddiesDatabase, `SELECT spotify_id,MAX(isrc) AS isrc,MAX(observed_at) AS observed_at
    FROM sh_queue_items
    WHERE spotify_id IS NOT NULL AND TRIM(spotify_id)<>'' AND observed_at>=${cutoff}
    GROUP BY spotify_id ORDER BY observed_at DESC LIMIT ${candidateLimit}`);
}

function existingRows(ids, database = factsDatabase) {
  if (!ids.length) return [];
  return query(database, `SELECT spotify_id,isrc,title,artist,display_title,thumbnail_url,
    spotify_url,source,fetched_at,raw_json FROM sh_track_metadata
    WHERE spotify_id IN (${ids.map(quote).join(',')})`);
}

async function spotifyMetadata(candidate) {
  const spotifyId = text(candidate.spotify_id);
  const spotifyUrl = `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`, {
      headers: { accept: 'application/json', 'user-agent': 'HomePanel-metadata-actions/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rawTitle = text(payload.title);
    if (!rawTitle) return null;
    const separator = rawTitle.lastIndexOf(' by ');
    const title = separator > 0 ? text(rawTitle.slice(0, separator)) : rawTitle;
    const artist = text(payload.author_name) || (separator > 0 ? text(rawTitle.slice(separator + 4)) : null);
    if (!title || !artist) return null;
    return {
      spotify_id: spotifyId,
      isrc: normalizeIsrc(candidate.isrc),
      title,
      artist,
      display_title: `${title} — ${artist}`,
      thumbnail_url: text(payload.thumbnail_url),
      spotify_url: spotifyUrl,
      source: 'spotify_oembed_actions',
      fetched_at: now,
      raw_json: JSON.stringify({ spotify: payload }),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

function metadataUpsert(row) {
  const columns = ['spotify_id','isrc','title','artist','display_title','thumbnail_url','spotify_url','source','fetched_at','raw_json'];
  return `INSERT INTO sh_track_metadata(${columns.join(',')}) VALUES(${columns.map((column) => quote(row[column])).join(',')})
    ON CONFLICT(spotify_id) DO UPDATE SET
      isrc=COALESCE(excluded.isrc,sh_track_metadata.isrc),
      title=CASE WHEN sh_track_metadata.title IS NULL OR TRIM(sh_track_metadata.title)='' OR sh_track_metadata.title=sh_track_metadata.spotify_id THEN excluded.title ELSE sh_track_metadata.title END,
      artist=CASE WHEN sh_track_metadata.artist IS NULL OR TRIM(sh_track_metadata.artist)='' OR sh_track_metadata.artist=sh_track_metadata.spotify_id OR sh_track_metadata.artist GLOB 'JP[A-Z0-9]*' THEN excluded.artist ELSE sh_track_metadata.artist END,
      display_title=COALESCE(sh_track_metadata.display_title,excluded.display_title),
      thumbnail_url=COALESCE(sh_track_metadata.thumbnail_url,excluded.thumbnail_url),
      spotify_url=COALESCE(sh_track_metadata.spotify_url,excluded.spotify_url),
      source=CASE WHEN excluded.fetched_at>=sh_track_metadata.fetched_at THEN excluded.source ELSE sh_track_metadata.source END,
      fetched_at=MAX(sh_track_metadata.fetched_at,excluded.fetched_at),
      raw_json=CASE WHEN excluded.fetched_at>=sh_track_metadata.fetched_at THEN excluded.raw_json ELSE sh_track_metadata.raw_json END;`;
}

function hydrateQueue(queue, bySpotify, byIsrc) {
  if (!Array.isArray(queue?.tracks)) return queue;
  let changed = false;
  const tracks = queue.tracks.map((track) => {
    if (track?.title && track?.artist && track?.thumbnail_url) return track;
    const row = bySpotify.get(text(track?.spotify_id)) || byIsrc.get(normalizeIsrc(track?.isrc));
    if (!row) return track;
    const next = {
      ...track,
      title: text(track?.title) || text(row.title),
      artist: text(track?.artist) || text(row.artist),
      thumbnail_url: text(track?.thumbnail_url) || text(row.thumbnail_url),
      spotify_id: text(track?.spotify_id) || text(row.spotify_id),
    };
    if (JSON.stringify(next) !== JSON.stringify(track)) changed = true;
    return next;
  });
  return changed ? { ...queue, tracks } : queue;
}

function readModelRepairStatements(metadata) {
  const current = query(factsDatabase, `SELECT channel_id,queue_json FROM sh_queue_read_model_current
    WHERE queue_json IS NOT NULL`);
  const bySpotify = new Map(metadata.map((row) => [text(row.spotify_id), row]).filter(([key]) => key));
  const byIsrc = new Map(metadata.map((row) => [normalizeIsrc(row.isrc), row]).filter(([key]) => key));
  const statements = [];
  for (const row of current) {
    let queue;
    try { queue = JSON.parse(String(row.queue_json || 'null')); } catch { continue; }
    const hydrated = hydrateQueue(queue, bySpotify, byIsrc);
    if (hydrated === queue) continue;
    statements.push(`UPDATE sh_queue_read_model_current SET queue_json=${quote(JSON.stringify(hydrated))}
      WHERE channel_id=${quote(row.channel_id)};`);
  }
  return statements;
}

const candidates = candidateRows();
const ids = candidates.map((row) => text(row.spotify_id)).filter(Boolean);
const current = existingRows(ids);
const currentById = new Map(current.map((row) => [text(row.spotify_id), row]));
const source = existingRows(ids, buddiesDatabase);
const sourceById = new Map(source.map((row) => [text(row.spotify_id), row]));
const unresolved = candidates.filter((candidate) => {
  const row = currentById.get(text(candidate.spotify_id));
  return !complete(row) && now - Number(row?.fetched_at || 0) >= refreshMs;
});
const reused = [];
const remoteCandidates = [];
for (const candidate of unresolved) {
  const sourceRow = sourceById.get(text(candidate.spotify_id));
  if (complete(sourceRow)) reused.push({ ...sourceRow, isrc: normalizeIsrc(sourceRow.isrc || candidate.isrc) });
  else remoteCandidates.push(candidate);
}
const fetched = (await mapConcurrent(remoteCandidates, fetchConcurrency, spotifyMetadata)).filter(Boolean);
const upserts = [...reused, ...fetched];
const merged = new Map([...current, ...upserts].map((row) => [text(row.spotify_id), row]));
const repairStatements = readModelRepairStatements([...merged.values()]);
const statements = [
  ...upserts.map(metadataUpsert),
  ...repairStatements,
  `INSERT INTO sh_minute_fact_runtime_state(task_name,last_started_at,last_success_at,last_failure_at,last_duration_ms,last_error,runs_total,succeeded_total,failed_total,processed_total,job_failures_total,last_processed_count,last_failed_count,pending_count,processing_count,dead_count,oldest_pending_minute,updated_at)
    VALUES('metadata-repair',${now},${Date.now()},NULL,0,NULL,1,1,0,${upserts.length},0,${upserts.length},0,0,0,0,NULL,${Date.now()})
    ON CONFLICT(task_name) DO UPDATE SET last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,last_error=NULL,runs_total=runs_total+1,succeeded_total=succeeded_total+1,processed_total=processed_total+excluded.processed_total,last_processed_count=excluded.last_processed_count,updated_at=excluded.updated_at;`,
];

const directory = mkdtempSync(join(workerRoot, '.track-metadata-actions-'));
try {
  const path = join(directory, 'apply.sql');
  writeFileSync(path, `${statements.join('\n')}\n`, 'utf8');
  wrangler(factsDatabase, '', { file: path });
  console.log(JSON.stringify({
    ok: true,
    candidates: candidates.length,
    unresolved: unresolved.length,
    reused_from_buddies: reused.length,
    fetched_from_spotify: fetched.length,
    read_models_repaired: repairStatements.length,
  }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
