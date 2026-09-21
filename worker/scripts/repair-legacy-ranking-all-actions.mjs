import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchIsrcMetadata } from '../src/isrc-metadata.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const candidateLimit = Math.max(1, Math.min(1000, Math.trunc(Number(process.env.TRACK_METADATA_LEGACY_LIMIT) || 500)));
const now = Date.now();

const TITLE_SQL = `title IS NULL OR TRIM(title)='' OR LOWER(TRIM(title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')`;
const ARTIST_SQL = `artist IS NULL OR TRIM(artist)='' OR LOWER(TRIM(artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—')`;
const TITLE_PLACEHOLDERS = new Set(['曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—']);
const ARTIST_PLACEHOLDERS = new Set(['アーティスト不明','unknown','unknown artist','_','-','—']);

function wrangler(command, options = {}) {
  const args = [wranglerScript, 'd1', 'execute', factsDatabase, '--remote', '--yes'];
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
  const value = String(output || '').trim();
  const starts = [value.indexOf('['), value.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${value.slice(0, 300)}`);
  const payload = JSON.parse(value.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  return containers.flatMap((container) => container?.results || container?.result?.results || container?.result?.[0]?.results || []);
}

function query(sql) { return rows(wrangler(sql)); }
function text(value) { const normalized = String(value ?? '').trim(); return normalized || null; }
function normalizeIsrc(value) {
  const normalized = String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : null;
}
function quote(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return `'${String(value).replaceAll('\u0000','').replaceAll("'","''")}'`;
}
function usable(value, type) {
  const source = text(value);
  if (!source) return null;
  const normalized = source.normalize('NFKC').toLowerCase();
  if ((type === 'title' ? TITLE_PLACEHOLDERS : ARTIST_PLACEHOLDERS).has(normalized)) return null;
  if (/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(source) || /^[A-Za-z0-9]{22}$/.test(source)) return null;
  return source;
}
function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

function candidates() {
  return query(`WITH unresolved AS (
    SELECT current.track_identity,current.track_id,current.title,current.artist,
      current.latest_like_count,current.latest_observed_at,
      tracks.title AS track_title,tracks.artist AS track_artist,
      COALESCE(NULLIF(TRIM(current.spotify_id),''),NULLIF(TRIM(tracks.spotify_id),''),
        (SELECT NULLIF(TRIM(o.spotify_id),'') FROM sh_track_ranking_occurrence o
          WHERE o.track_identity=current.track_identity AND o.spotify_id IS NOT NULL AND TRIM(o.spotify_id)<>''
          ORDER BY o.latest_observed_at DESC,o.occurrence_key DESC LIMIT 1),
        CASE WHEN current.track_identity LIKE 'spotify:%' THEN SUBSTR(current.track_identity,9)
             WHEN current.track_identity LIKE 'key:spotify:%' THEN SUBSTR(current.track_identity,13) END) AS spotify_id,
      COALESCE(NULLIF(TRIM(current.isrc),''),NULLIF(TRIM(tracks.isrc),''),
        (SELECT NULLIF(TRIM(o.isrc),'') FROM sh_track_ranking_occurrence o
          WHERE o.track_identity=current.track_identity AND o.isrc IS NOT NULL AND TRIM(o.isrc)<>''
          ORDER BY o.latest_observed_at DESC,o.occurrence_key DESC LIMIT 1),
        CASE WHEN current.track_identity LIKE 'isrc:%' THEN SUBSTR(current.track_identity,6)
             WHEN current.track_identity LIKE 'key:isrc:%' THEN SUBSTR(current.track_identity,10) END) AS isrc,
      (SELECT o.title FROM sh_track_ranking_occurrence o
        WHERE o.track_identity=current.track_identity AND o.title IS NOT NULL AND TRIM(o.title)<>''
          AND LOWER(TRIM(o.title)) NOT IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')
        ORDER BY o.latest_observed_at DESC,o.occurrence_key DESC LIMIT 1) AS occurrence_title,
      (SELECT o.artist FROM sh_track_ranking_occurrence o
        WHERE o.track_identity=current.track_identity AND o.artist IS NOT NULL AND TRIM(o.artist)<>''
          AND LOWER(TRIM(o.artist)) NOT IN ('アーティスト不明','unknown','unknown artist','_','-','—')
        ORDER BY o.latest_observed_at DESC,o.occurrence_key DESC LIMIT 1) AS occurrence_artist
    FROM sh_track_ranking_current current
    LEFT JOIN sh_tracks tracks ON tracks.id=current.track_id
    WHERE current.latest_like_count>0 AND (
      current.title IS NULL OR TRIM(current.title)='' OR LOWER(TRIM(current.title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')
      OR current.artist IS NULL OR TRIM(current.artist)='' OR LOWER(TRIM(current.artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—')
    )
  )
  SELECT unresolved.*,
    dictionary.title AS dictionary_title,dictionary.artist AS dictionary_artist,dictionary.spotify_id AS dictionary_spotify_id,
    metadata.title AS isrc_title,metadata.artist AS isrc_artist
  FROM unresolved
  LEFT JOIN sh_track_dictionary dictionary
    ON dictionary.isrc=UPPER(REPLACE(REPLACE(TRIM(unresolved.isrc),'-',''),' ',''))
  LEFT JOIN sh_isrc_metadata metadata
    ON metadata.isrc=UPPER(REPLACE(REPLACE(TRIM(unresolved.isrc),'-',''),' ',''))
  ORDER BY unresolved.latest_like_count DESC,unresolved.latest_observed_at DESC,unresolved.track_identity
  LIMIT ${candidateLimit}`);
}

function localMetadata(candidate) {
  const title = usable(candidate.title,'title') || usable(candidate.dictionary_title,'title') || usable(candidate.isrc_title,'title') || usable(candidate.track_title,'title') || usable(candidate.occurrence_title,'title');
  const artist = usable(candidate.artist,'artist') || usable(candidate.dictionary_artist,'artist') || usable(candidate.isrc_artist,'artist') || usable(candidate.track_artist,'artist') || usable(candidate.occurrence_artist,'artist');
  if (!title || !artist) return null;
  return { ...candidate, recovered_title:title, recovered_artist:artist, isrc:normalizeIsrc(candidate.isrc), spotify_id:text(candidate.spotify_id) || text(candidate.dictionary_spotify_id), source:'legacy_ranking_local_actions', fetched_at:now, raw_json:null, method:'local' };
}

async function recover(candidate) {
  const local = localMetadata(candidate);
  if (local) return local;
  const isrc = normalizeIsrc(candidate.isrc);
  if (!isrc) return null;
  const metadata = await fetchIsrcMetadata(isrc, { requestTimeoutMs: 8000 }).catch(() => null);
  await sleep(1100);
  const title = usable(candidate.title,'title') || usable(metadata?.title,'title');
  const artist = usable(candidate.artist,'artist') || usable(metadata?.artist,'artist');
  if (!title || !artist) return null;
  return { ...candidate, recovered_title:title, recovered_artist:artist, isrc, spotify_id:text(candidate.spotify_id) || text(candidate.dictionary_spotify_id), source:'legacy_ranking_musicbrainz_actions', fetched_at:Number(metadata?.fetched_at || now), raw_json:text(metadata?.raw_json), method:'musicbrainz' };
}

function repairStatements(row) {
  const title=quote(row.recovered_title), artist=quote(row.recovered_artist), isrc=quote(row.isrc), spotifyId=quote(row.spotify_id);
  const statements=[];
  if (row.isrc && row.method === 'musicbrainz') statements.push(`INSERT INTO sh_isrc_metadata(isrc,title,artist,source,fetched_at,raw_json)
    VALUES(${isrc},${title},${artist},${quote(row.source)},${quote(row.fetched_at)},${quote(row.raw_json)})
    ON CONFLICT(isrc) DO UPDATE SET
      title=CASE WHEN sh_isrc_metadata.title IS NULL OR TRIM(sh_isrc_metadata.title)='' THEN excluded.title ELSE sh_isrc_metadata.title END,
      artist=CASE WHEN sh_isrc_metadata.artist IS NULL OR TRIM(sh_isrc_metadata.artist)='' THEN excluded.artist ELSE sh_isrc_metadata.artist END,
      source=excluded.source,fetched_at=MAX(sh_isrc_metadata.fetched_at,excluded.fetched_at),raw_json=COALESCE(excluded.raw_json,sh_isrc_metadata.raw_json);`);
  if (row.isrc) statements.push(`INSERT INTO sh_track_dictionary(isrc,spotify_id,title,artist,thumbnail_url,metadata_source,metadata_fetched_at,updated_at)
    VALUES(${isrc},${spotifyId},${title},${artist},NULL,${quote(row.source)},${quote(row.fetched_at)},${now})
    ON CONFLICT(isrc) DO UPDATE SET
      spotify_id=COALESCE(NULLIF(TRIM(sh_track_dictionary.spotify_id),''),excluded.spotify_id),
      title=CASE WHEN sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)='' OR LOWER(TRIM(sh_track_dictionary.title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—') THEN excluded.title ELSE sh_track_dictionary.title END,
      artist=CASE WHEN sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)='' OR LOWER(TRIM(sh_track_dictionary.artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—') THEN excluded.artist ELSE sh_track_dictionary.artist END,
      metadata_source=CASE WHEN sh_track_dictionary.metadata_source IN ('unknown','track_identity') THEN excluded.metadata_source ELSE sh_track_dictionary.metadata_source END,
      metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);`);
  if (row.spotify_id) statements.push(`INSERT INTO sh_track_metadata(spotify_id,isrc,title,artist,display_title,thumbnail_url,spotify_url,source,fetched_at,raw_json)
    VALUES(${spotifyId},${isrc},${title},${artist},${quote(`${row.recovered_title} — ${row.recovered_artist}`)},NULL,${quote(`https://open.spotify.com/track/${row.spotify_id}`)},${quote(row.source)},${quote(row.fetched_at)},${quote(row.raw_json)})
    ON CONFLICT(spotify_id) DO UPDATE SET
      isrc=COALESCE(NULLIF(TRIM(sh_track_metadata.isrc),''),excluded.isrc),
      title=CASE WHEN sh_track_metadata.title IS NULL OR TRIM(sh_track_metadata.title)='' OR sh_track_metadata.title=sh_track_metadata.spotify_id THEN excluded.title ELSE sh_track_metadata.title END,
      artist=CASE WHEN sh_track_metadata.artist IS NULL OR TRIM(sh_track_metadata.artist)='' OR sh_track_metadata.artist=sh_track_metadata.spotify_id THEN excluded.artist ELSE sh_track_metadata.artist END,
      display_title=COALESCE(NULLIF(TRIM(sh_track_metadata.display_title),''),excluded.display_title),source=excluded.source,fetched_at=MAX(sh_track_metadata.fetched_at,excluded.fetched_at),raw_json=COALESCE(excluded.raw_json,sh_track_metadata.raw_json);`);
  statements.push(`UPDATE sh_track_ranking_current SET title=CASE WHEN ${TITLE_SQL} THEN ${title} ELSE title END,artist=CASE WHEN ${ARTIST_SQL} THEN ${artist} ELSE artist END,isrc=COALESCE(NULLIF(TRIM(isrc),''),${isrc}),spotify_id=COALESCE(NULLIF(TRIM(spotify_id),''),${spotifyId}) WHERE track_identity=${quote(row.track_identity)};`);
  statements.push(`UPDATE sh_track_ranking_occurrence SET title=CASE WHEN ${TITLE_SQL} THEN ${title} ELSE title END,artist=CASE WHEN ${ARTIST_SQL} THEN ${artist} ELSE artist END,isrc=COALESCE(NULLIF(TRIM(isrc),''),${isrc}),spotify_id=COALESCE(NULLIF(TRIM(spotify_id),''),${spotifyId}) WHERE track_identity=${quote(row.track_identity)};`);
  if (row.track_id != null) statements.push(`UPDATE sh_tracks SET title=CASE WHEN ${TITLE_SQL} OR title=spotify_id THEN ${title} ELSE title END,artist=CASE WHEN ${ARTIST_SQL} OR artist=spotify_id THEN ${artist} ELSE artist END,isrc=COALESCE(NULLIF(TRIM(isrc),''),${isrc}),spotify_id=COALESCE(NULLIF(TRIM(spotify_id),''),${spotifyId}) WHERE id=${quote(row.track_id)};`);
  return statements;
}

const backlog=candidates();
const recovered=[];
for (const candidate of backlog) {
  const row=await recover(candidate);
  if (row) recovered.push(row);
}
const statements=recovered.flatMap(repairStatements);
if (statements.length) {
  const directory=mkdtempSync(join(workerRoot,'.legacy-ranking-all-actions-'));
  try { const path=join(directory,'apply.sql'); writeFileSync(path,`${statements.join('\n')}\n`,'utf8'); wrangler('',{file:path}); }
  finally { rmSync(directory,{recursive:true,force:true}); }
}
const remaining=query(`SELECT COUNT(*) AS total,
  SUM(CASE WHEN isrc IS NOT NULL AND TRIM(isrc)<>'' THEN 1 ELSE 0 END) AS with_isrc,
  SUM(CASE WHEN isrc IS NULL OR TRIM(isrc)='' THEN 1 ELSE 0 END) AS without_isrc
  FROM sh_track_ranking_current WHERE latest_like_count>0 AND (
    title IS NULL OR TRIM(title)='' OR LOWER(TRIM(title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')
    OR artist IS NULL OR TRIM(artist)='' OR LOWER(TRIM(artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—'))`)[0] || {};
console.log(JSON.stringify({ok:true,candidates:backlog.length,recovered:recovered.length,recovered_local:recovered.filter((r)=>r.method==='local').length,recovered_musicbrainz:recovered.filter((r)=>r.method==='musicbrainz').length,remaining_unresolved:Number(remaining.total||0),remaining_with_isrc:Number(remaining.with_isrc||0),remaining_without_isrc:Number(remaining.without_isrc||0)}));
