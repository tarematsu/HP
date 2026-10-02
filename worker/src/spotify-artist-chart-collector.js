import { publishSpotifyPagesReadModel } from './spotify-pages-read-model.js';

const SPOTIFY_CHARTS_CLIENT_ID = '44407c71b3b24071865aaa4fea948a15';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_CHART_URL = 'https://charts-spotify-com-service.spotify.com/auth/v0/charts/artist-jp-daily/latest';
const SPOTIFY_WORKER_SCRIPT = 'sh-spotify-playcount-collector';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ENTRIES = 200;
const MIN_ENTRIES = 50;
const MAX_ARTIST_NAME = 240;
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

function previousJstDateKey(timestamp = Date.now()) {
  return new Date(Number(timestamp) + JST_OFFSET_MS - DAY_MS).toISOString().slice(0, 10);
}

function optionalInteger(value, minimum, maximum) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function normalizedArtistName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/gu, ' ')
    .trim();
}

function artistIdFromUri(value) {
  const uri = String(value || '').trim();
  if (uri.includes('spotify:artist:')) {
    return uri.split('spotify:artist:', 2)[1].split(/[/?#]/u, 1)[0].slice(0, 80);
  }
  const marker = '/artist/';
  const offset = uri.indexOf(marker);
  if (offset < 0) return '';
  return uri.slice(offset + marker.length).split(/[/?#]/u, 1)[0].slice(0, 80);
}

function findChartDate(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') {
    const match = value.match(/\b\d{4}-\d{2}-\d{2}\b/u);
    return match?.[0] || '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findChartDate(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['chartDate', 'displayDate', 'latestDate', 'date']) {
    const candidate = String(value?.[key] || '').slice(0, 10);
    if (DATE_KEY.test(candidate)) return candidate;
  }
  for (const item of Object.values(value)) {
    const found = findChartDate(item, depth + 1);
    if (found) return found;
  }
  return '';
}

export function normalizeSpotifyArtistChart(payload, observedAt = Date.now()) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entries)) {
    throw new Error('Spotify artist chart response has no entries array');
  }
  const entries = [];
  for (const raw of payload.entries.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;
    const chart = raw.chartEntryData;
    if (!chart || typeof chart !== 'object') continue;
    const rank = optionalInteger(chart.currentRank, 1, 200);
    if (rank == null) continue;
    const metadata = [raw.artistMetadata, raw.metadata, raw.trackMetadata]
      .find((item) => item && typeof item === 'object');
    if (!metadata) continue;
    const artistName = String(
      metadata.artistName || metadata.name || metadata.displayName || '',
    ).trim().slice(0, MAX_ARTIST_NAME);
    if (!artistName) continue;
    const artistId = artistIdFromUri(metadata.artistUri || metadata.uri);
    entries.push({
      rank,
      artist_name: artistName,
      artist_id: artistId,
      previous_rank: optionalInteger(chart.previousRank, 1, 200),
      peak_rank: optionalInteger(chart.peakRank, 1, 200),
      streak: optionalInteger(
        chart.consecutiveAppearancesOnChart ?? chart.appearancesOnChart,
        0,
        100_000,
      ),
    });
  }
  if (entries.length < MIN_ENTRIES) {
    throw new Error(`Spotify artist chart normalized only ${entries.length} entries`);
  }
  const chartDate = findChartDate(payload);
  if (!DATE_KEY.test(chartDate)) throw new Error('Spotify artist chart date is missing');
  return {
    chart_date: chartDate,
    observed_at: Number(observedAt),
    entries,
  };
}

export async function refreshSpotifyChartsAccessToken(refreshToken, fetchImpl = fetch) {
  const token = String(refreshToken || '').trim();
  if (!token) throw new Error('SPOTIFY_CHARTS_REFRESH_TOKEN is not configured');
  const response = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: SPOTIFY_CHARTS_CLIENT_ID,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(body?.error || response.status);
    if (code === 'invalid_grant') {
      throw new Error('Spotify Charts refresh token expired or was revoked; bootstrap is required');
    }
    throw new Error(`Spotify Charts token refresh failed: ${code}`);
  }
  const accessToken = String(body?.access_token || '').trim();
  if (!accessToken) throw new Error('Spotify token response did not contain access_token');
  return {
    access_token: accessToken,
    refresh_token: String(body?.refresh_token || token).trim(),
    rotated: Boolean(body?.refresh_token) && String(body.refresh_token).trim() !== token,
  };
}

export async function updateSpotifyRefreshWorkerSecret(env, refreshToken, fetchImpl = fetch) {
  const apiToken = String(env?.CLOUDFLARE_WORKER_SECRET_TOKEN || '').trim();
  const accountId = String(env?.CLOUDFLARE_WORKER_SECRET_ACCOUNT_ID || '').trim();
  if (!apiToken || !accountId) {
    throw new Error('Cloudflare Worker secret updater is not configured');
  }
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`
      + `/workers/scripts/${encodeURIComponent(SPOTIFY_WORKER_SCRIPT)}/secrets`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'SPOTIFY_CHARTS_REFRESH_TOKEN',
        text: String(refreshToken || '').trim(),
        type: 'secret_text',
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    const detail = Array.isArray(body?.errors)
      ? body.errors.map((item) => String(item?.message || '')).filter(Boolean).join('; ')
      : '';
    throw new Error(`Cloudflare refresh-token secret update failed: ${detail || response.status}`);
  }
  return true;
}

async function fetchSpotifyArtistChart(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(SPOTIFY_CHART_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7',
      origin: 'https://charts.spotify.com',
      referer: 'https://charts.spotify.com/',
    },
  });
  if (!response.ok) throw new Error(`Spotify artist chart returned HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeSpotifyArtistChart(payload, Date.now());
}

async function latestStoredChartDate(db) {
  const row = await db.prepare(`SELECT latest_chart_date
    FROM sh_spotify_artist_chart_sync_state
    WHERE id=1`).first();
  return String(row?.latest_chart_date || '').trim();
}

async function persistSpotifyArtistChart(db, capture) {
  const rosterResult = await db.prepare(`SELECT artist_key,spotify_artist_id,artist_name
    FROM sh_spotify_artists
    WHERE trim(COALESCE(spotify_artist_id,''))<>''
    ORDER BY artist_key`).all();
  const roster = Array.isArray(rosterResult?.results) ? rosterResult.results : [];
  const byId = new Map();
  const byName = new Map();
  for (const row of roster) {
    const artist = {
      artist_key: String(row?.artist_key || '').trim(),
      spotify_artist_id: String(row?.spotify_artist_id || '').trim(),
      artist_name: String(row?.artist_name || '').trim(),
    };
    if (!artist.artist_key || !artist.artist_name) continue;
    if (artist.spotify_artist_id) byId.set(artist.spotify_artist_id, artist);
    byName.set(normalizedArtistName(artist.artist_name), artist);
  }

  const matched = new Map();
  for (const entry of capture.entries) {
    const artist = (entry.artist_id ? byId.get(entry.artist_id) : null)
      || byName.get(normalizedArtistName(entry.artist_name));
    if (artist) matched.set(artist.artist_key, { artist, entry });
  }

  const now = Date.now();
  const statements = [
    db.prepare('DELETE FROM sh_spotify_artist_chart_daily WHERE chart_date=?').bind(capture.chart_date),
  ];
  for (const { artist, entry } of matched.values()) {
    statements.push(db.prepare(`INSERT INTO sh_spotify_artist_chart_daily (
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
        now,
        now,
      ));
  }
  statements.push(db.prepare(`INSERT INTO sh_spotify_artist_chart_sync_state (
      id,backfill_completed,latest_chart_date,latest_observed_at,updated_at
    ) VALUES (1,1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      backfill_completed=1,
      latest_chart_date=excluded.latest_chart_date,
      latest_observed_at=excluded.latest_observed_at,
      updated_at=excluded.updated_at`)
    .bind(capture.chart_date, capture.observed_at, now));
  await db.batch(statements);
  return matched.size;
}

export async function runSpotifyArtistChartScheduled(env, scheduledTime = Date.now(), dependencies = {}) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) throw new Error('OTHER_DB binding is required for Spotify artist chart');
  const expectedDate = previousJstDateKey(scheduledTime);
  const latestDate = await latestStoredChartDate(db);
  if (latestDate && latestDate >= expectedDate) {
    return { skipped: true, reason: 'already-current', chart_date: latestDate };
  }

  const fetchImpl = dependencies.fetchImpl || fetch;
  const refreshed = await refreshSpotifyChartsAccessToken(
    env?.SPOTIFY_CHARTS_REFRESH_TOKEN,
    fetchImpl,
  );
  if (refreshed.rotated) {
    await updateSpotifyRefreshWorkerSecret(env, refreshed.refresh_token, fetchImpl);
  }

  const capture = await fetchSpotifyArtistChart(refreshed.access_token, fetchImpl);
  if (capture.chart_date < expectedDate) {
    return {
      skipped: true,
      reason: 'source-not-published',
      chart_date: capture.chart_date,
      expected_date: expectedDate,
    };
  }

  const matched = await persistSpotifyArtistChart(db, capture);
  const readModel = await publishSpotifyPagesReadModel(env);
  return {
    skipped: false,
    chart_date: capture.chart_date,
    matched_artists: matched,
    refresh_token_rotated: refreshed.rotated,
    read_model_published: Boolean(readModel?.published),
  };
}
