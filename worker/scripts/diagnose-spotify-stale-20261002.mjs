import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import {
  fetchAnonymousSession,
  fetchAlbumPlaycountPayload,
  normalizeAlbumTracks,
} from '../src/spotify-playcount-source.js';
import { SPOTIFY_TARGET_ARTISTS } from '../src/spotify-playcount-common.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

const ALBUM_TRACKS_HASH = '3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e';
const root = resolve(import.meta.dirname, '..');
const wranglerScript = join(root, 'node_modules/wrangler/bin/wrangler.js');
const config = JSON.parse(readFileSync(join(root, 'wrangler.spotify-playcount.jsonc'), 'utf8'));
const database = config.d1_databases.find((row) => row.binding === 'OTHER_DB')?.database_name;
if (!database) throw new Error('OTHER_DB database not found');
const db = createWranglerRemoteD1({ database, cwd: root, wranglerScript });

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

let v2Status = null;
let v2Error = null;
let v2Playcount = null;
try {
  const response = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'app-platform': 'WebPlayer',
      origin: 'https://open.spotify.com',
      referer: 'https://open.spotify.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      operationName: 'queryAlbumTracks',
      variables: { uri: `spotify:album:${sample.album_id}`, offset: 0, limit: 300 },
      extensions: { persistedQuery: { version: 1, sha256Hash: ALBUM_TRACKS_HASH } },
    }),
  });
  v2Status = response.status;
  const text = await response.text();
  const payload = JSON.parse(text);
  if (!response.ok || payload?.errors?.length) {
    v2Error = payload?.errors?.map((entry) => entry?.message).filter(Boolean).join('; ') || text.slice(0, 500);
  } else {
    v2Playcount = normalizeAlbumTracks(payload, SPOTIFY_TARGET_ARTISTS)
      .find((row) => row.track_id === sample.track_id)?.playcount ?? null;
  }
} catch (error) {
  v2Error = error instanceof Error ? error.message : String(error);
}

let readModel = null;
const directory = mkdtempSync(join(tmpdir(), 'spotify-read-model-'));
try {
  const outputPath = join(directory, 'spotify-playcounts.json');
  const objectKey = pagesActionsR2ResponseKey('spotify-playcounts');
  execFileSync(process.execPath, [
    wranglerScript, 'r2', 'object', 'get', `sh-pages-responses/${objectKey}`,
    '--remote', '--file', outputPath,
  ], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const envelope = JSON.parse(readFileSync(outputPath, 'utf8'));
  const body = JSON.parse(envelope.body);
  const dates = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value.snapshot_date || ''))) dates.add(value.snapshot_date);
    for (const child of Object.values(value)) walk(child);
  };
  walk(body);
  readModel = {
    object_key: objectKey,
    updated_at: envelope.updated_at,
    source_revision: envelope.source_revision,
    snapshot_dates: [...dates].sort(),
  };
} catch (error) {
  readModel = { error: error instanceof Error ? error.message : String(error) };
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  event: 'spotify_stale_diagnostic',
  runs: runs.results || [],
  sample,
  candidate,
  normal_playcount: normal?.playcount ?? null,
  no_cache_playcount: noCache?.playcount ?? null,
  v2_status: v2Status,
  v2_error: v2Error,
  v2_playcount: v2Playcount,
  normal_delta_from_2026_10_01: normal?.playcount == null ? null : normal.playcount - Number(sample.playcount),
  no_cache_delta_from_2026_10_01: noCache?.playcount == null ? null : noCache.playcount - Number(sample.playcount),
  v2_delta_from_2026_10_01: v2Playcount == null ? null : v2Playcount - Number(sample.playcount),
  read_model: readModel,
}, null, 2));
