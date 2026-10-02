import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import {
  fetchAnonymousSession,
  fetchAlbumPlaycountPayload,
  normalizeAlbumTracks,
} from '../src/spotify-playcount-source.js';
import { SPOTIFY_TARGET_ARTISTS } from '../src/spotify-playcount-common.js';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'wrangler.spotify-playcount.jsonc'), 'utf8'));
const database = config.d1_databases.find((row) => row.binding === 'OTHER_DB')?.database_name;
if (!database) throw new Error('OTHER_DB database not found');
const db = createWranglerRemoteD1({
  database,
  cwd: root,
  wranglerScript: join(root, 'node_modules/wrangler/bin/wrangler.js'),
});

const runs = await db.prepare(`SELECT snapshot_date,status,attempt_no,run_token,albums_queued,albums_completed,
    tracks_collected,started_at,attempt_started_at,completed_at,updated_at,last_error
  FROM sh_spotify_collection_runs
  WHERE snapshot_date IN ('2026-10-01','2026-10-02')
  ORDER BY snapshot_date`).all();

const sample = await db.prepare(`SELECT d.track_id,d.playcount,s.album_id,t.artist_key
  FROM sh_spotify_playcount_daily_canonical d
  INNER JOIN sh_spotify_tracks s ON s.track_id=d.track_id
  INNER JOIN sh_spotify_track_targets t ON t.track_id=d.track_id
  WHERE d.snapshot_date='2026-10-01' AND t.artist_key='sakurazaka46'
  ORDER BY d.playcount DESC LIMIT 1`).first();
if (!sample?.track_id || !sample?.album_id) throw new Error('Spotify diagnostic sample not found');

const candidate = await db.prepare(`SELECT playcount,collected_at FROM sh_spotify_playcount_candidates
  WHERE snapshot_date='2026-10-02' AND track_id=? ORDER BY collected_at DESC LIMIT 1`)
  .bind(sample.track_id).first();

const session = await fetchAnonymousSession(config.vars || {}, fetch);
const normalPayload = await fetchAlbumPlaycountPayload(sample.album_id, config.vars || {}, session, fetch);
let nonce = 0;
const noCacheFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers || {});
  if (url.hostname === 'api-partner.spotify.com') {
    nonce += 1;
    url.searchParams.set('_spotify_diag_nocache', `${Date.now()}-${nonce}`);
    headers.set('cache-control', 'no-cache, no-store, max-age=0');
    headers.set('pragma', 'no-cache');
  }
  return fetch(url, { ...init, headers, cache: 'no-store' });
};
const noCachePayload = await fetchAlbumPlaycountPayload(sample.album_id, config.vars || {}, session, noCacheFetch);
const normal = normalizeAlbumTracks(normalPayload, SPOTIFY_TARGET_ARTISTS)
  .find((row) => row.track_id === sample.track_id);
const noCache = normalizeAlbumTracks(noCachePayload, SPOTIFY_TARGET_ARTISTS)
  .find((row) => row.track_id === sample.track_id);

console.log(JSON.stringify({
  event: 'spotify_stale_diagnostic',
  runs: runs.results || [],
  sample,
  candidate,
  normal_playcount: normal?.playcount ?? null,
  no_cache_playcount: noCache?.playcount ?? null,
  normal_delta_from_2026_10_01: normal?.playcount == null ? null : normal.playcount - Number(sample.playcount),
  no_cache_delta_from_2026_10_01: noCache?.playcount == null ? null : noCache.playcount - Number(sample.playcount),
}, null, 2));
