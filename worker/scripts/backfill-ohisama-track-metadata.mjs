import { runWrangler } from './cloudflare-queues.mjs';

const OHISAMA_DB = 'stationhead-ohisama';
const MINUTE_DB = 'stationhead-minute';
const APPLY = process.argv.includes('--apply');
const QUERY_CHUNK_SIZE = 70;
const WRITE_CHUNK_SIZE = 30;

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

function mergeMetadata(target, source) {
  if (!target || !source) return target;
  for (const key of ['spotify_id', 'isrc', 'title', 'artist']) {
    if (!text(target[key]) && text(source[key])) target[key] = text(source[key]);
  }
  return target;
}

function collectOhisamaMetadata() {
  return query(OHISAMA_DB, `WITH sources AS (
      SELECT track_id,spotify_id,isrc,title,artist FROM sh_track_plays WHERE track_id IS NOT NULL
      UNION ALL
      SELECT track_id,spotify_id,isrc,title,artist FROM sh_track_like_current WHERE track_id IS NOT NULL
      UNION ALL
      SELECT track_id,spotify_id,isrc,title,artist FROM sh_track_like_observations WHERE track_id IS NOT NULL
      UNION ALL
      SELECT
        CAST(json_extract(value,'$.track_id') AS INTEGER) AS track_id,
        json_extract(value,'$.spotify_id') AS spotify_id,
        json_extract(value,'$.isrc') AS isrc,
        json_extract(value,'$.title') AS title,
        json_extract(value,'$.artist') AS artist
      FROM sh_track_daily_summary,json_each(sh_track_daily_summary.tracks_json)
    )
    SELECT track_id,
      MAX(NULLIF(TRIM(spotify_id),'')) AS spotify_id,
      MAX(NULLIF(TRIM(isrc),'')) AS isrc,
      MAX(NULLIF(TRIM(title),'')) AS title,
      MAX(NULLIF(TRIM(artist),'')) AS artist
    FROM sources
    WHERE track_id IS NOT NULL
    GROUP BY track_id
    ORDER BY track_id`);
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

function loadMinuteTracks(trackIds) {
  const rows = [];
  for (const part of chunks(trackIds)) {
    rows.push(...query(MINUTE_DB, `SELECT id,canonical_key,isrc,spotify_id,stationhead_track_id,title,artist
      FROM sh_tracks WHERE id IN (${part.join(',')}) ORDER BY id`));
  }
  return rows;
}

function loadIdentityOwners(column, values) {
  const allowed = new Set(['spotify_id', 'isrc']);
  if (!allowed.has(column)) throw new Error(`unsupported identity column: ${column}`);
  const expression = column === 'isrc' ? 'UPPER(isrc)' : 'spotify_id';
  const owners = new Map();
  for (const part of chunks([...new Set(values.map(text).filter(Boolean))])) {
    if (!part.length) continue;
    const inList = part.map(sqlText).join(',');
    for (const row of query(MINUTE_DB, `SELECT id,${expression} AS value FROM sh_tracks WHERE ${expression} IN (${inList})`)) {
      const key = text(row.value);
      const id = integer(row.id);
      if (key && id) owners.set(key, id);
    }
  }
  return owners;
}

function buildUpdates(minuteRows, metadataById, spotifyOwners, isrcOwners) {
  const updates = [];
  const identityConflicts = [];
  const fieldCounts = { title: 0, artist: 0, spotify_id: 0, isrc: 0 };
  const claimedSpotify = new Map(spotifyOwners);
  const claimedIsrc = new Map(isrcOwners);

  for (const row of minuteRows) {
    const id = integer(row.id);
    const source = metadataById.get(id);
    if (!id || !source) continue;

    const title = text(row.title) || text(source.title);
    const artist = text(row.artist) || text(source.artist);
    let spotifyId = text(row.spotify_id);
    let isrc = text(row.isrc)?.toUpperCase() || null;

    const sourceSpotify = text(source.spotify_id);
    if (!spotifyId && sourceSpotify) {
      const owner = claimedSpotify.get(sourceSpotify);
      if (!owner || owner === id) {
        spotifyId = sourceSpotify;
        claimedSpotify.set(sourceSpotify, id);
      } else {
        identityConflicts.push({ track_id: id, field: 'spotify_id', value: sourceSpotify, owner_track_id: owner });
      }
    }

    const sourceIsrc = text(source.isrc)?.toUpperCase() || null;
    if (!isrc && sourceIsrc) {
      const owner = claimedIsrc.get(sourceIsrc);
      if (!owner || owner === id) {
        isrc = sourceIsrc;
        claimedIsrc.set(sourceIsrc, id);
      } else {
        identityConflicts.push({ track_id: id, field: 'isrc', value: sourceIsrc, owner_track_id: owner });
      }
    }

    const changed = {
      title: !text(row.title) && Boolean(title),
      artist: !text(row.artist) && Boolean(artist),
      spotify_id: !text(row.spotify_id) && Boolean(spotifyId),
      isrc: !text(row.isrc) && Boolean(isrc),
    };
    if (!Object.values(changed).some(Boolean)) continue;
    for (const [field, didChange] of Object.entries(changed)) if (didChange) fieldCounts[field] += 1;

    updates.push({ id, title, artist, spotify_id: spotifyId, isrc });
  }

  return { updates, identityConflicts, fieldCounts };
}

function applyUpdates(updates) {
  const now = Date.now();
  for (const part of chunks(updates, WRITE_CHUNK_SIZE)) {
    const statements = [];
    for (const row of part) {
      statements.push(`UPDATE sh_tracks SET
        title=COALESCE(title,${sqlText(row.title)}),
        artist=COALESCE(artist,${sqlText(row.artist)}),
        spotify_id=COALESCE(spotify_id,${sqlText(row.spotify_id)}),
        isrc=COALESCE(isrc,${sqlText(row.isrc)})
        WHERE id=${row.id}`);
      if (row.spotify_id) statements.push(`INSERT INTO sh_track_aliases(alias_type,alias_value,track_id,first_seen_at,last_seen_at)
        SELECT 'spotify_id',${sqlText(row.spotify_id)},${row.id},${now},${now}
        WHERE NOT EXISTS(SELECT 1 FROM sh_track_aliases WHERE alias_type='spotify_id' AND alias_value=${sqlText(row.spotify_id)})`);
      if (row.isrc) statements.push(`INSERT INTO sh_track_aliases(alias_type,alias_value,track_id,first_seen_at,last_seen_at)
        SELECT 'isrc',${sqlText(row.isrc)},${row.id},${now},${now}
        WHERE NOT EXISTS(SELECT 1 FROM sh_track_aliases WHERE alias_type='isrc' AND alias_value=${sqlText(row.isrc)})`);
    }
    execute(MINUTE_DB, statements.join(';'));
  }
}

function summarize(trackIds, rows, metadataById) {
  const byId = new Map(rows.map((row) => [integer(row.id), row]));
  const unresolved = [];
  let withTitle = 0;
  let withArtist = 0;
  let withSpotify = 0;
  let withIsrc = 0;
  let sourceMetadata = 0;

  for (const id of trackIds) {
    const row = byId.get(id);
    const source = metadataById.get(id);
    if (source && [source.title, source.artist, source.spotify_id, source.isrc].some(text)) sourceMetadata += 1;
    if (text(row?.title)) withTitle += 1;
    if (text(row?.artist)) withArtist += 1;
    if (text(row?.spotify_id)) withSpotify += 1;
    if (text(row?.isrc)) withIsrc += 1;
    if (!text(row?.title) || !text(row?.artist)) {
      unresolved.push({
        track_id: id,
        stationhead_track_id: integer(row?.stationhead_track_id),
        canonical_key: text(row?.canonical_key),
        title: text(row?.title),
        artist: text(row?.artist),
        source_title: text(source?.title),
        source_artist: text(source?.artist),
        source_spotify_id: text(source?.spotify_id),
        source_isrc: text(source?.isrc),
      });
    }
  }

  return {
    total_track_ids: trackIds.length,
    found_in_sh_tracks: rows.length,
    source_metadata_track_ids: sourceMetadata,
    with_title: withTitle,
    with_artist: withArtist,
    with_spotify_id: withSpotify,
    with_isrc: withIsrc,
    unresolved_count: unresolved.length,
    unresolved: unresolved.slice(0, 200),
  };
}

const sourceRows = collectOhisamaMetadata();
const metadataById = new Map();
for (const row of sourceRows) {
  const id = integer(row.track_id);
  if (!id) continue;
  const target = metadataById.get(id) || { track_id: id, spotify_id: null, isrc: null, title: null, artist: null };
  metadataById.set(id, mergeMetadata(target, row));
}

const trackIds = collectOhisamaTrackIds();
const beforeRows = loadMinuteTracks(trackIds);
const sourceMetadataRows = [...metadataById.values()];
const spotifyOwners = loadIdentityOwners('spotify_id', sourceMetadataRows.map((row) => row.spotify_id));
const isrcOwners = loadIdentityOwners('isrc', sourceMetadataRows.map((row) => text(row.isrc)?.toUpperCase()));
const { updates, identityConflicts, fieldCounts } = buildUpdates(
  beforeRows,
  metadataById,
  spotifyOwners,
  isrcOwners,
);

const before = summarize(trackIds, beforeRows, metadataById);
if (APPLY && updates.length) applyUpdates(updates);
const afterRows = APPLY ? loadMinuteTracks(trackIds) : beforeRows;
const after = summarize(trackIds, afterRows, metadataById);

console.log(JSON.stringify({
  event: 'ohisama_track_metadata_backfill',
  applied: APPLY,
  candidate_updates: updates.length,
  field_updates: fieldCounts,
  identity_conflict_count: identityConflicts.length,
  identity_conflicts: identityConflicts.slice(0, 100),
  before,
  after,
}));
