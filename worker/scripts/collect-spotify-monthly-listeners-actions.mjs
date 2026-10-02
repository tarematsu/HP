import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  collectSpotifyMonthlyListeners,
  SPOTIFY_MONTHLY_LISTENER_ARTISTS,
} from '../src/spotify-monthly-listeners.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'wrangler.spotify-playcount.jsonc'), 'utf8'));
const database = config.d1_databases.find((row) => row.binding === 'OTHER_DB')?.database_name;
if (!database) throw new Error('OTHER_DB configuration missing');

const snapshotDate = String(
  process.env.SPOTIFY_MONTHLY_SNAPSHOT_DATE || process.argv[2] || '',
).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  throw new Error('SPOTIFY_MONTHLY_SNAPSHOT_DATE must be YYYY-MM-DD');
}

const db = createWranglerRemoteD1({
  database,
  cwd: root,
  wranglerScript: join(root, 'node_modules/wrangler/bin/wrangler.js'),
});

const result = await collectSpotifyMonthlyListeners({
  ...(config.vars || {}),
  OTHER_DB: db,
}, snapshotDate);

if (Number(result.failed || 0) > 0) {
  throw new Error(`Spotify monthly listener collection failed for ${result.failed} artists`);
}

const verification = await db.prepare(`SELECT
    daily.artist_key,artist.artist_name,artist.spotify_artist_id,
    daily.monthly_listeners,daily.collected_at
  FROM sh_spotify_artist_monthly_listeners_daily daily
  INNER JOIN sh_spotify_artists artist ON artist.artist_key=daily.artist_key
  WHERE daily.snapshot_date=?
  ORDER BY daily.artist_key`).bind(snapshotDate).all();
const rows = Array.isArray(verification?.results) ? verification.results : [];
const expectedKeys = new Set(SPOTIFY_MONTHLY_LISTENER_ARTISTS.map((artist) => artist.artist_key));
const targetRows = rows.filter((row) => expectedKeys.has(String(row.artist_key || '')));
const actualKeys = new Set(targetRows.map((row) => String(row.artist_key || '')));
const missing = SPOTIFY_MONTHLY_LISTENER_ARTISTS
  .filter((artist) => !actualKeys.has(artist.artist_key))
  .map((artist) => artist.artist_key);
if (missing.length) throw new Error(`Spotify monthly listener rows missing: ${missing.join(',')}`);

console.log(JSON.stringify({
  event: 'spotify_monthly_listeners_manual_complete',
  snapshot_date: snapshotDate,
  expected_artists: SPOTIFY_MONTHLY_LISTENER_ARTISTS.length,
  rows: targetRows,
}));
