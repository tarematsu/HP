import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const database = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ARTIST_ID = /^[A-Za-z0-9]{10,80}$/;

function normalizedArtistName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/gu, ' ')
    .trim();
}

function optionalInteger(value, minimum, maximum) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

export function validateSpotifyArtistChartCapture(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Spotify artist chart capture must be an object');
  }
  const chartDate = String(value.chart_date || '').trim();
  const observedAt = Number(value.observed_at);
  if (Number(value.version) !== 1 || value.chart_id !== 'artist-jp-daily') {
    throw new Error('Spotify artist chart capture has an unsupported schema');
  }
  if (!DATE_KEY.test(chartDate) || !Number.isSafeInteger(observedAt) || observedAt <= 0) {
    throw new Error('Spotify artist chart capture metadata is invalid');
  }
  if (!Array.isArray(value.entries) || value.entries.length < 50 || value.entries.length > 200) {
    throw new Error('Spotify artist chart capture entry count is invalid');
  }
  const entries = value.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Spotify artist chart entry is invalid');
    }
    const rank = optionalInteger(entry.rank, 1, 200);
    const artistName = String(entry.artist_name || '').trim().slice(0, 240);
    const artistId = String(entry.artist_id || '').trim();
    if (rank == null || !artistName || (artistId && !ARTIST_ID.test(artistId))) {
      throw new Error('Spotify artist chart entry fields are invalid');
    }
    return {
      rank,
      artist_name: artistName,
      artist_id: artistId,
      previous_rank: optionalInteger(entry.previous_rank, 1, 200),
      peak_rank: optionalInteger(entry.peak_rank, 1, 200),
      streak: optionalInteger(entry.streak, 0, 100_000),
    };
  });
  return {
    chart_date: chartDate,
    observed_at: observedAt,
    received_at: Number.isSafeInteger(Number(value.received_at)) ? Number(value.received_at) : observedAt,
    entries,
  };
}

export function matchSpotifyArtistChartEntries(capture, roster) {
  const byId = new Map(roster
    .filter((artist) => artist.spotify_artist_id)
    .map((artist) => [artist.spotify_artist_id, artist]));
  const byName = new Map(roster
    .filter((artist) => artist.artist_name)
    .map((artist) => [normalizedArtistName(artist.artist_name), artist]));
  const matched = new Map();
  for (const entry of capture.entries) {
    const artist = (entry.artist_id ? byId.get(entry.artist_id) : null)
      || byName.get(normalizedArtistName(entry.artist_name));
    if (!artist) continue;
    matched.set(artist.artist_key, { artist, entry });
  }
  return [...matched.values()];
}

export async function persistSpotifyArtistChart(db, rawCapture, now = Date.now()) {
  const capture = validateSpotifyArtistChartCapture(rawCapture);
  const existing = await db.prepare(`SELECT COUNT(*) AS row_count
    FROM sh_spotify_artist_chart_daily
    WHERE chart_date=?`).bind(capture.chart_date).first();
  if (Number(existing?.row_count || 0) > 0) {
    return { chart_date: capture.chart_date, matched: Number(existing.row_count), skipped: true };
  }

  const rosterResult = await db.prepare(`SELECT artist_key,spotify_artist_id,artist_name
    FROM sh_spotify_artists
    WHERE trim(COALESCE(spotify_artist_id,''))<>''
    ORDER BY artist_key`).all();
  const roster = (Array.isArray(rosterResult?.results) ? rosterResult.results : []).map((row) => ({
    artist_key: String(row?.artist_key || '').trim(),
    spotify_artist_id: String(row?.spotify_artist_id || '').trim(),
    artist_name: String(row?.artist_name || '').trim(),
  })).filter((row) => row.artist_key && row.artist_name);
  const matched = matchSpotifyArtistChartEntries(capture, roster);

  const statements = [
    db.prepare('DELETE FROM sh_spotify_artist_chart_daily WHERE chart_date=?').bind(capture.chart_date),
    ...matched.map(({ artist, entry }) => db.prepare(`INSERT INTO sh_spotify_artist_chart_daily (
        chart_date,artist_key,spotify_artist_id,artist_name,rank,previous_rank,peak_rank,streak,
        observed_at,received_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        capture.chart_date,
        artist.artist_key,
        artist.spotify_artist_id,
        artist.artist_name,
        entry.rank,
        entry.previous_rank,
        entry.peak_rank,
        entry.streak,
        capture.observed_at,
        capture.received_at,
        now,
      )),
    db.prepare(`INSERT INTO sh_spotify_artist_chart_sync_state (
        id,backfill_completed,latest_chart_date,latest_observed_at,updated_at
      ) VALUES (1,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        latest_chart_date=excluded.latest_chart_date,
        latest_observed_at=excluded.latest_observed_at,
        updated_at=excluded.updated_at`).bind(capture.chart_date, capture.observed_at, now),
  ];
  await db.batch(statements);
  return { chart_date: capture.chart_date, matched: matched.length, skipped: false };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('capture JSON path is required');
  const capture = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  const db = createWranglerRemoteD1({ database, cwd: workerRoot, wranglerScript });
  const result = await persistSpotifyArtistChart(db, capture);
  console.log(JSON.stringify({ ok: true, event: 'spotify_artist_chart_persisted', ...result }));
}

if (process.argv[1] && import.meta.url === fileURLToPath(new URL(`file://${process.argv[1]}`)).startsWith('/') ? new URL(`file://${process.argv[1]}`).href : import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, event: 'spotify_artist_chart_persist_failed', error: String(error?.message || error) }));
    process.exitCode = 1;
  });
}
