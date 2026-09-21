import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';

function rows(output) {
  const value = String(output || '').trim();
  const starts = [value.indexOf('['), value.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${value.slice(0, 300)}`);
  const payload = JSON.parse(value.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  return containers.flatMap((container) => container?.results || container?.result?.results || container?.result?.[0]?.results || []);
}

function query(sql) {
  const output = execFileSync(process.execPath, [
    wranglerScript,
    'd1', 'execute', factsDatabase,
    '--remote', '--yes', '--json', '--command', sql,
  ], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return rows(output);
}

const unresolved = query(`SELECT
  current.track_identity,
  current.track_id,
  current.title,
  current.artist,
  current.isrc,
  current.spotify_id,
  current.latest_like_count,
  current.latest_observed_at,
  tracks.title AS track_title,
  tracks.artist AS track_artist,
  tracks.isrc AS track_isrc,
  tracks.spotify_id AS track_spotify_id,
  metadata.title AS metadata_title,
  metadata.artist AS metadata_artist,
  metadata.source AS metadata_source
FROM sh_track_ranking_current current
LEFT JOIN sh_tracks tracks ON tracks.id=current.track_id
LEFT JOIN sh_track_metadata metadata ON metadata.spotify_id=COALESCE(NULLIF(TRIM(current.spotify_id),''),NULLIF(TRIM(tracks.spotify_id),''))
WHERE current.latest_like_count>0 AND (
  current.title IS NULL OR TRIM(current.title)='' OR LOWER(TRIM(current.title)) IN ('曲名不明','曲名…','曲名...','unknown','unknown title','_','-','—')
  OR current.artist IS NULL OR TRIM(current.artist)='' OR LOWER(TRIM(current.artist)) IN ('アーティスト不明','unknown','unknown artist','_','-','—')
)
ORDER BY current.latest_like_count DESC,current.latest_observed_at DESC,current.track_identity
LIMIT 20`);

console.log(JSON.stringify({ ok: true, unresolved_count: unresolved.length, unresolved }, null, 2));
