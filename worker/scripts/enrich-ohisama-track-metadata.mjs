import { runWrangler } from './cloudflare-queues.mjs';
import { fetchTrackMetadata } from '../src/track-metadata.js';

const OHISAMA_DB = 'stationhead-ohisama';
const MINUTE_DB = 'stationhead-minute';
const QUERY_CHUNK_SIZE = 70;
const WRITE_CHUNK_SIZE = 20;
const FETCH_CONCURRENCY = 5;

function parseJsonOutput(value) {
  const source = String(value || '').trim();
  const starts = [source.indexOf('['), source.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${source.slice(0, 300)}`);
  return JSON.parse(source.slice(Math.min(...starts)));
}

function resultRows(value) {
  const containers = Array.isArray(value) ? value : [value];
  return containers.flatMap((container) => container?.results || container?.result?.results || []);
}

function query(database, command) {
  const result = runWrangler([
    'd1', 'execute', database,
    '--remote', '--yes', '--json',
    '--command', command,
  ], { capture: true });
  return resultRows(parseJsonOutput(result.stdout));
}

function execute(database, command) {
  if (!command.trim()) return;
  runWrangler([
    'd1', 'execute', database,
    '--remote', '--yes',
    '--command', command,
  ], { capture: true, mirror: true });
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sqlText(value) {
  return value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
}

function chunks(values, size = QUERY_CHUNK_SIZE) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function collectOhisamaTrackIds() {
  const rows = query(OHISAMA_DB, `WITH ids AS (
      SELECT track_id FROM sh_track_plays WHERE track_id IS NOT NULL
      UNION
      SELECT track_id FROM sh_track_like_current WHERE track_id IS NOT NULL
      UNION
      SELECT track_id FROM sh_track_like_observations WHERE track_id IS NOT NULL
      UNION
      SELECT CAST(json_extract(value,'$.track_id') AS INTEGER)
      FROM sh_track_daily_summary,json_each(sh_track_daily_summary.tracks_json)
      WHERE json_extract(value,'$.track_id') IS NOT NULL
    )
    SELECT track_id FROM ids WHERE track_id IS NOT NULL ORDER BY track_id`);
  return [...new Set(rows.map((row) => integer(row.track_id)).filter(Boolean))];
}

function loadTracks(trackIds) {
  const rows = [];
  for (const part of chunks(trackIds)) {
    rows.push(...query(MINUTE_DB, `SELECT id,spotify_id,isrc,title,artist
      FROM sh_tracks
      WHERE id IN (${part.join(',')})
      ORDER BY id`));
  }
  return rows;
}

function needsPresentation(row) {
  return Boolean(text(row?.spotify_id) && (!text(row?.title) || !text(row?.artist)));
}

async function mapConcurrent(values, concurrency, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await mapper(values[index], index);
    }
  }));
  return result;
}

async function fetchMetadata(row) {
  try {
    const metadata = await fetchTrackMetadata({
      spotify_id: text(row.spotify_id),
      isrc: text(row.isrc),
    }, {
      collectionSignal: null,
      requestTimeoutMs: 8_000,
    });
    const title = text(metadata?.title);
    const artist = text(metadata?.artist);
    if (!title || !artist || text(metadata?.spotify_id) !== text(row.spotify_id)) return null;
    return {
      track_id: integer(row.id),
      spotify_id: text(row.spotify_id),
      isrc: text(row.isrc)?.toUpperCase() || null,
      title,
      artist,
      display_title: text(metadata.display_title) || `${title} — ${artist}`,
      thumbnail_url: text(metadata.thumbnail_url),
      spotify_url: text(metadata.spotify_url) || `https://open.spotify.com/track/${row.spotify_id}`,
      source: text(metadata.source) || 'spotify_oembed',
      fetched_at: Number(metadata.fetched_at) || Date.now(),
      raw_json: JSON.stringify(metadata.raw || {}),
    };
  } catch {
    return null;
  }
}

function centralStatements(rows) {
  const statements = [];
  for (const row of rows) {
    statements.push(`UPDATE sh_tracks SET
      title=CASE WHEN title IS NULL OR TRIM(title)='' THEN ${sqlText(row.title)} ELSE title END,
      artist=CASE WHEN artist IS NULL OR TRIM(artist)='' THEN ${sqlText(row.artist)} ELSE artist END
      WHERE id=${row.track_id} AND spotify_id=${sqlText(row.spotify_id)}`);
    statements.push(`INSERT INTO sh_track_metadata(
        spotify_id,isrc,title,artist,display_title,thumbnail_url,spotify_url,source,fetched_at,raw_json
      ) VALUES(
        ${sqlText(row.spotify_id)},${sqlText(row.isrc)},${sqlText(row.title)},${sqlText(row.artist)},
        ${sqlText(row.display_title)},${sqlText(row.thumbnail_url)},${sqlText(row.spotify_url)},
        ${sqlText(row.source)},${Math.trunc(row.fetched_at)},${sqlText(row.raw_json)}
      ) ON CONFLICT(spotify_id) DO UPDATE SET
        isrc=COALESCE(sh_track_metadata.isrc,excluded.isrc),
        title=CASE WHEN sh_track_metadata.title IS NULL OR TRIM(sh_track_metadata.title)='' OR sh_track_metadata.title=sh_track_metadata.spotify_id THEN excluded.title ELSE sh_track_metadata.title END,
        artist=CASE WHEN sh_track_metadata.artist IS NULL OR TRIM(sh_track_metadata.artist)='' OR sh_track_metadata.artist=sh_track_metadata.spotify_id OR sh_track_metadata.artist GLOB 'JP[A-Z0-9]*' THEN excluded.artist ELSE sh_track_metadata.artist END,
        display_title=COALESCE(sh_track_metadata.display_title,excluded.display_title),
        thumbnail_url=COALESCE(sh_track_metadata.thumbnail_url,excluded.thumbnail_url),
        spotify_url=COALESCE(sh_track_metadata.spotify_url,excluded.spotify_url),
        source=excluded.source,
        fetched_at=MAX(sh_track_metadata.fetched_at,excluded.fetched_at),
        raw_json=excluded.raw_json`);
  }
  return statements;
}

function localStatements(rows) {
  const statements = [];
  for (const row of rows) {
    statements.push(`UPDATE sh_track_plays SET
      title=CASE WHEN title IS NULL OR TRIM(title)='' THEN ${sqlText(row.title)} ELSE title END,
      artist=CASE WHEN artist IS NULL OR TRIM(artist)='' THEN ${sqlText(row.artist)} ELSE artist END,
      thumbnail_url=CASE WHEN thumbnail_url IS NULL OR TRIM(thumbnail_url)='' THEN ${sqlText(row.thumbnail_url)} ELSE thumbnail_url END
      WHERE track_id=${row.track_id}`);
    for (const table of ['sh_track_like_current', 'sh_track_like_observations']) {
      statements.push(`UPDATE ${table} SET
        title=CASE WHEN title IS NULL OR TRIM(title)='' THEN ${sqlText(row.title)} ELSE title END,
        artist=CASE WHEN artist IS NULL OR TRIM(artist)='' THEN ${sqlText(row.artist)} ELSE artist END
        WHERE track_id=${row.track_id}`);
    }
  }
  return statements;
}

function updateDailySummaries(metadataById) {
  const summaries = query(OHISAMA_DB, `SELECT period_key,tracks_json FROM sh_track_daily_summary ORDER BY period_key`);
  const statements = [];
  let changedPeriods = 0;
  let changedRows = 0;
  for (const summary of summaries) {
    let tracks;
    try { tracks = JSON.parse(String(summary.tracks_json || '[]')); } catch { continue; }
    if (!Array.isArray(tracks)) continue;
    let changed = false;
    const next = tracks.map((track) => {
      const metadata = metadataById.get(integer(track?.track_id));
      if (!metadata) return track;
      const title = text(track?.title) || metadata.title;
      const artist = text(track?.artist) || metadata.artist;
      const spotifyId = text(track?.spotify_id) || metadata.spotify_id;
      if (title === text(track?.title) && artist === text(track?.artist) && spotifyId === text(track?.spotify_id)) return track;
      changed = true;
      changedRows += 1;
      return { ...track, title, artist, spotify_id: spotifyId };
    });
    if (!changed) continue;
    changedPeriods += 1;
    statements.push(`UPDATE sh_track_daily_summary SET tracks_json=${sqlText(JSON.stringify(next))}
      WHERE period_key=${sqlText(summary.period_key)}`);
  }
  for (const part of chunks(statements, WRITE_CHUNK_SIZE)) execute(OHISAMA_DB, part.join(';'));
  return { changedPeriods, changedRows };
}

function executeStatements(database, statements) {
  for (const part of chunks(statements, WRITE_CHUNK_SIZE)) execute(database, part.join(';'));
}

function presentationAudit(trackIds) {
  const rows = loadTracks(trackIds);
  const complete = rows.filter((row) => text(row.title) && text(row.artist));
  return {
    total_track_ids: trackIds.length,
    found_in_sh_tracks: rows.length,
    with_title_artist: complete.length,
    unresolved: rows
      .filter((row) => !text(row.title) || !text(row.artist))
      .map((row) => ({
        track_id: integer(row.id),
        spotify_id: text(row.spotify_id),
        isrc: text(row.isrc),
        title: text(row.title),
        artist: text(row.artist),
      })),
  };
}

const trackIds = collectOhisamaTrackIds();
const beforeRows = loadTracks(trackIds);
const candidates = beforeRows.filter(needsPresentation);
const before = presentationAudit(trackIds);
const fetched = (await mapConcurrent(candidates, FETCH_CONCURRENCY, fetchMetadata)).filter(Boolean);
const metadataById = new Map(fetched.map((row) => [row.track_id, row]));

executeStatements(MINUTE_DB, centralStatements(fetched));
executeStatements(OHISAMA_DB, localStatements(fetched));
const daily = updateDailySummaries(metadataById);
const after = presentationAudit(trackIds);

console.log(JSON.stringify({
  event: 'ohisama_spotify_metadata_enrichment',
  candidates: candidates.length,
  fetched: fetched.length,
  failed: candidates.length - fetched.length,
  daily_summary_periods_updated: daily.changedPeriods,
  daily_summary_rows_updated: daily.changedRows,
  before,
  after,
}));
