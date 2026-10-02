import { fetchAnonymousSession } from './spotify-playcount-source.js';
import {
  integer,
  logEvent,
  resultsOf,
  safeText,
  SPOTIFY_TARGET_ARTISTS,
  truncateError,
} from './spotify-playcount-common.js';

const SPOTIFY_PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const ARTIST_OVERVIEW_HASH = '5b9e64f43843fa3a9b6a98543600299b0a2cbbbccfdcdcef2402eb9c1017ca4c';
const PUBLIC_PAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const FETCH_CONCURRENCY = 5;

export const SPOTIFY_MONTHLY_LISTENER_ARTISTS = Object.freeze([
  ...SPOTIFY_TARGET_ARTISTS,
  Object.freeze({
    artist_key: 'sakamichi-selection',
    artist_name: '坂道選抜',
    spotify_artist_id: '44VXOtivzQwdqj1Xs80SaX',
  }),
]);

export function monthlyListenersFromArtistOverview(payload) {
  const value = integer(payload?.data?.artistUnion?.stats?.monthlyListeners);
  return value != null && value >= 0 ? value : null;
}

export function spotifyArtistOverviewUrl(spotifyArtistId, env = {}) {
  const url = new URL(safeText(env?.SPOTIFY_PATHFINDER_URL, SPOTIFY_PATHFINDER_URL));
  url.searchParams.set('operationName', 'queryArtistOverview');
  url.searchParams.set('variables', JSON.stringify({
    uri: `spotify:artist:${spotifyArtistId}`,
    locale: '',
    preReleaseV2: true,
  }));
  url.searchParams.set('extensions', JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: ARTIST_OVERVIEW_HASH },
  }));
  return url.toString();
}

async function fetchArtistMonthlyListeners(artist, env, session, fetchImpl) {
  const response = await fetchImpl(spotifyArtistOverviewUrl(artist.spotify_artist_id, env), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${session.accessToken}`,
      'user-agent': PUBLIC_PAGE_USER_AGENT,
    },
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(`Spotify queryArtistOverview failed: HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Spotify queryArtistOverview returned invalid JSON');
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    const detail = payload.errors.map((entry) => safeText(entry?.message)).filter(Boolean).join('; ');
    throw new Error(`Spotify queryArtistOverview GraphQL error${detail ? `: ${detail.slice(0, 400)}` : ''}`);
  }
  const monthlyListeners = monthlyListenersFromArtistOverview(payload);
  if (monthlyListeners == null) {
    throw new Error(`Spotify queryArtistOverview returned no monthly listeners for ${artist.artist_key}`);
  }
  return monthlyListeners;
}

async function ensureMonthlyListenerArtists(db) {
  await db.batch(SPOTIFY_MONTHLY_LISTENER_ARTISTS.map((artist) => db.prepare(`INSERT OR IGNORE INTO sh_spotify_artists (
      artist_key,artist_name,spotify_artist_id
    ) VALUES (?,?,?)`)
    .bind(artist.artist_key, artist.artist_name, artist.spotify_artist_id)));
}

async function artistsForSnapshot(db, snapshotDate, missingOnly = false) {
  await ensureMonthlyListenerArtists(db);
  if (!missingOnly) return SPOTIFY_MONTHLY_LISTENER_ARTISTS;

  const result = await db.prepare(`SELECT artist_key
    FROM sh_spotify_artist_monthly_listeners_daily
    WHERE snapshot_date=?`).bind(snapshotDate).all();
  const existing = new Set(resultsOf(result).map((row) => safeText(row?.artist_key)).filter(Boolean));
  return SPOTIFY_MONTHLY_LISTENER_ARTISTS.filter((artist) => !existing.has(artist.artist_key));
}

export async function collectSpotifyMonthlyListeners(env, snapshotDate, dependencies = {}) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) return { snapshot_date: snapshotDate, attempted: 0, saved: 0, failed: 0 };
  const artists = await artistsForSnapshot(db, snapshotDate, Boolean(dependencies.missingOnly));
  if (!artists.length) {
    logEvent('spotify_monthly_listeners_skipped', {
      snapshot_date: snapshotDate,
      reason: dependencies.missingOnly ? 'no-missing-artists' : 'no-artists',
    });
    return { snapshot_date: snapshotDate, attempted: 0, saved: 0, failed: 0 };
  }

  const fetchImpl = dependencies.fetch || fetch;
  const session = dependencies.session || await fetchAnonymousSession(env, fetchImpl);
  const collectedAt = Date.now();
  const rows = [];
  let failed = 0;

  for (let offset = 0; offset < artists.length; offset += FETCH_CONCURRENCY) {
    const batch = artists.slice(offset, offset + FETCH_CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map(async (artist) => ({
      artist,
      monthly_listeners: await fetchArtistMonthlyListeners(artist, env, session, fetchImpl),
    })));
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        rows.push(outcome.value);
        return;
      }
      failed += 1;
      const artist = batch[index];
      logEvent('spotify_monthly_listeners_artist_error', {
        snapshot_date: snapshotDate,
        artist_key: artist?.artist_key,
        error: truncateError(outcome.reason, 500),
      });
    });
  }

  if (rows.length) {
    await db.batch(rows.map(({ artist, monthly_listeners }) => db.prepare(`INSERT INTO sh_spotify_artist_monthly_listeners_daily (
        snapshot_date,artist_key,monthly_listeners,collected_at
      ) VALUES (?,?,?,?)
      ON CONFLICT(snapshot_date,artist_key) DO UPDATE SET
        monthly_listeners=excluded.monthly_listeners,
        collected_at=excluded.collected_at`)
      .bind(snapshotDate, artist.artist_key, monthly_listeners, collectedAt)));
  }

  logEvent('spotify_monthly_listeners_complete', {
    snapshot_date: snapshotDate,
    attempted: artists.length,
    saved: rows.length,
    failed,
    missing_only: Boolean(dependencies.missingOnly),
  });
  return { snapshot_date: snapshotDate, attempted: artists.length, saved: rows.length, failed };
}
