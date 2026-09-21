import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const candidateLimit = bounded(process.env.TRACK_METADATA_LEGACY_LIMIT, 500, 1, 1000);
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

function query(sql) {
  return rows(wrangler(factsDatabase, sql));
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

function normalizedTitle(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

const TITLE_PLACEHOLDERS = new Set(['曲名不明', '曲名…', '曲名...', 'unknown', 'unknown title', '_', '-', '—']);
const ARTIST_PLACEHOLDERS = new Set(['アーティスト不明', 'unknown', 'unknown artist', '_', '-', '—']);

function placeholder(value, type) {
  const source = text(value);
  if (!source) return true;
  const normalized = source.normalize('NFKC').toLowerCase();
  if ((type === 'title' ? TITLE_PLACEHOLDERS : ARTIST_PLACEHOLDERS).has(normalized)) return true;
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(source)
    || /^[A-Za-z0-9]{22}$/.test(source)
    || /^spotify[_:-]?[a-z0-9]{8,}$/i.test(source);
}

function candidates() {
  return query(`WITH unresolved AS (
    SELECT current.track_identity,current.track_id,current.title,current.artist,
      current.latest_like_count,current.latest_observed_at,
      COALESCE(
        NULLIF(TRIM(current.spotify_id),''),
        NULLIF(TRIM(tracks.spotify_id),''),
        CASE
          WHEN current.track_identity LIKE 'spotify:%' THEN SUBSTR(current.track_identity,9)
          WHEN current.track_identity LIKE 'key:spotify:%' THEN SUBSTR(current.track_identity,13)
          ELSE NULL
        END
      ) AS spotify_id,
      COALESCE(NULLIF(TRIM(current.isrc),''),NULLIF(TRIM(tracks.isrc),'')) AS isrc,
      (SELECT item.duration_ms
        FROM sh_queue_revision_items item
        WHERE item.track_id=current.track_id
          AND item.duration_ms IS NOT NULL AND item.duration_ms>0
        ORDER BY item.revision_id DESC
        LIMIT 1) AS duration_ms
    FROM sh_track_ranking_current current
    LEFT JOIN sh_tracks tracks ON tracks.id=current.track_id
    WHERE current.latest_like_count>0
      AND (
        current.title IS NULL OR TRIM(current.title)=''
        OR LOWER(TRIM(current.title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')
        OR current.artist IS NULL OR TRIM(current.artist)=''
        OR LOWER(TRIM(current.artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—')
      )
  )
  SELECT track_identity,track_id,title,artist,spotify_id,isrc,duration_ms,latest_like_count,latest_observed_at
  FROM unresolved
  WHERE spotify_id IS NOT NULL AND TRIM(spotify_id)<>''
  ORDER BY latest_like_count DESC,latest_observed_at DESC,track_identity
  LIMIT ${candidateLimit}`);
}

async function appleMetadata(title, durationMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=song&country=JP&limit=25`;
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'HomePanel-legacy-ranking-repair/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const expectedTitle = normalizedTitle(title);
    const exact = (Array.isArray(payload?.results) ? payload.results : [])
      .filter((item) => normalizedTitle(item?.trackName) === expectedTitle);
    if (!exact.length) return null;
    const expectedDuration = Number(durationMs);
    if (Number.isFinite(expectedDuration) && expectedDuration > 0) {
      exact.sort((left, right) => (
        Math.abs(Number(left?.trackTimeMillis || 0) - expectedDuration)
        - Math.abs(Number(right?.trackTimeMillis || 0) - expectedDuration)
      ));
      const best = exact[0];
      if (Math.abs(Number(best?.trackTimeMillis || 0) - expectedDuration) <= 5_000) return best;
    }
    if (exact.length === 1) return exact[0];
    const artists = [...new Set(exact.map((item) => text(item?.artistName)).filter(Boolean))];
    if (artists.length === 1) return exact.find((item) => text(item?.artistName)) || null;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function spotifyMetadata(candidate) {
  const spotifyId = text(candidate.spotify_id);
  if (!spotifyId) return null;
  const spotifyUrl = `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`, {
      headers: { accept: 'application/json', 'user-agent': 'HomePanel-legacy-ranking-repair/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rawTitle = text(payload.title);
    if (!rawTitle) return null;
    const separator = rawTitle.lastIndexOf(' by ');
    const title = separator > 0 ? text(rawTitle.slice(0, separator)) : rawTitle;
    let artist = text(payload.author_name) || (separator > 0 ? text(rawTitle.slice(separator + 4)) : null);
    let apple = null;
    if (!artist) {
      apple = await appleMetadata(title, candidate.duration_ms);
      artist = text(apple?.artistName);
    }
    if (!title || !artist || placeholder(title, 'title') || placeholder(artist, 'artist')) return null;
    return {
      ...candidate,
      spotify_id: spotifyId,
      isrc: normalizeIsrc(candidate.isrc),
      recovered_title: title,
      recovered_artist: artist,
      display_title: `${title} — ${artist}`,
      thumbnail_url: text(payload.thumbnail_url) || text(apple?.artworkUrl100),
      spotify_url: spotifyUrl,
      source: apple ? 'legacy_ranking_spotify_itunes_actions' : 'legacy_ranking_spotify_actions',
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

const TITLE_SQL = `title IS NULL OR TRIM(title)='' OR LOWER(TRIM(title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')`;
const ARTIST_SQL = `artist IS NULL OR TRIM(artist)='' OR LOWER(TRIM(artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—')`;

function repairStatements(row) {
  const title = quote(row.recovered_title);
  const artist = quote(row.recovered_artist);
  const isrc = quote(row.isrc);
  const spotifyId = quote(row.spotify_id);
  const statements = [
    `INSERT INTO sh_track_metadata(spotify_id,isrc,title,artist,display_title,thumbnail_url,spotify_url,source,fetched_at,raw_json)
      VALUES(${spotifyId},${isrc},${title},${artist},${quote(row.display_title)},${quote(row.thumbnail_url)},${quote(row.spotify_url)},${quote(row.source)},${now},${quote(row.raw_json)})
      ON CONFLICT(spotify_id) DO UPDATE SET
        isrc=COALESCE(NULLIF(TRIM(sh_track_metadata.isrc),''),excluded.isrc),
        title=CASE WHEN sh_track_metadata.title IS NULL OR TRIM(sh_track_metadata.title)='' OR LOWER(TRIM(sh_track_metadata.title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—') OR sh_track_metadata.title=sh_track_metadata.spotify_id THEN excluded.title ELSE sh_track_metadata.title END,
        artist=CASE WHEN sh_track_metadata.artist IS NULL OR TRIM(sh_track_metadata.artist)='' OR LOWER(TRIM(sh_track_metadata.artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—') OR sh_track_metadata.artist=sh_track_metadata.spotify_id THEN excluded.artist ELSE sh_track_metadata.artist END,
        display_title=COALESCE(NULLIF(TRIM(sh_track_metadata.display_title),''),excluded.display_title),
        thumbnail_url=COALESCE(NULLIF(TRIM(sh_track_metadata.thumbnail_url),''),excluded.thumbnail_url),
        spotify_url=COALESCE(NULLIF(TRIM(sh_track_metadata.spotify_url),''),excluded.spotify_url),
        source=excluded.source,fetched_at=excluded.fetched_at,raw_json=excluded.raw_json;`,
    `UPDATE sh_track_ranking_current SET
      title=CASE WHEN ${TITLE_SQL} THEN ${title} ELSE title END,
      artist=CASE WHEN ${ARTIST_SQL} THEN ${artist} ELSE artist END,
      isrc=COALESCE(NULLIF(TRIM(isrc),''),${isrc}),
      spotify_id=COALESCE(NULLIF(TRIM(spotify_id),''),${spotifyId})
      WHERE track_identity=${quote(row.track_identity)};`,
    `UPDATE sh_track_ranking_occurrence SET
      title=CASE WHEN ${TITLE_SQL} THEN ${title} ELSE title END,
      artist=CASE WHEN ${ARTIST_SQL} THEN ${artist} ELSE artist END,
      isrc=COALESCE(NULLIF(TRIM(isrc),''),${isrc}),
      spotify_id=COALESCE(NULLIF(TRIM(spotify_id),''),${spotifyId})
      WHERE track_identity=${quote(row.track_identity)};`,
  ];
  if (row.track_id != null) {
    statements.push(`UPDATE sh_tracks SET
      title=CASE WHEN ${TITLE_SQL} OR title=spotify_id THEN ${title} ELSE title END,
      artist=CASE WHEN ${ARTIST_SQL} OR artist=spotify_id THEN ${artist} ELSE artist END,
      isrc=COALESCE(NULLIF(TRIM(isrc),''),${isrc}),
      spotify_id=COALESCE(NULLIF(TRIM(spotify_id),''),${spotifyId})
      WHERE id=${quote(row.track_id)};`);
  }
  return statements;
}

const backlog = candidates();
const recovered = (await mapConcurrent(backlog, fetchConcurrency, spotifyMetadata)).filter(Boolean);
const statements = recovered.flatMap(repairStatements);

if (statements.length) {
  const directory = mkdtempSync(join(workerRoot, '.legacy-ranking-metadata-actions-'));
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
  candidates: backlog.length,
  recovered: recovered.length,
  remaining_without_spotify_id: query(`SELECT COUNT(*) AS count
    FROM sh_track_ranking_current
    WHERE latest_like_count>0 AND (
      title IS NULL OR TRIM(title)='' OR LOWER(TRIM(title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')
      OR artist IS NULL OR TRIM(artist)='' OR LOWER(TRIM(artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—')
    ) AND (spotify_id IS NULL OR TRIM(spotify_id)='')`)[0]?.count || 0,
}));
