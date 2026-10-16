import { SPOTIFY_CHART_SOURCES, spotifyChartModelKey } from '../../packages/sh-shared/spotify-charts.mjs';
import { refreshSpotifyChartsAccessToken, updateSpotifyRefreshWorkerSecret } from './spotify-artist-chart-collector.js';
import { normalizeJapanChart } from './spotify-japan-chart-data.js';
import { parseSpotifyPlaylistPositions } from './spotify-playlist-collector.js';
import { pagesR2ResponseKey, saveMaterializedR2Response } from './pages-response-r2.js';

export const SPOTIFY_CHART_WORK = 'spotify-japan-chart-work';
// Acknowledge jobs already queued before Viral charts were removed. Their retry
// chains must stop without making Spotify, R2 or Queue requests.
const RETIRED_CHART_IDS = new Set(['viral-jp-daily', 'viral-jp-weekly']);
const API = 'https://charts-spotify-com-service.spotify.com/auth/v0/charts/';
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30, s-maxage=300', vary: 'accept-encoding' };
const AUTH_CACHE_KEY = 'spotify/charts/private/access-session.json';
export const SPOTIFY_VIRAL_HITS_JAPAN_URL = 'https://open.spotify.com/playlist/37i9dQZF1DWZZbpkxU5t9L';
const dayMs = 86400000;
const previous = (date, period) => new Date(Date.parse(`${date}T00:00:00Z`) - dayMs * (period === 'weekly' ? 7 : 1)).toISOString().slice(0, 10);
async function read(r2, key, fallback) {
  const object = await r2.get(pagesR2ResponseKey(key));
  return object ? await object.json() : fallback;
}
async function save(r2, key, data) {
  return saveMaterializedR2Response(r2, key, JSON.stringify(data), 200, HEADERS, Date.now(), 0);
}
const stateKey = id => `spotify/charts/state/${id}.json`;
function sourceStatus(state) {
  if (state.latest_status === 'error' || state.history_status === 'error') return 'error';
  return state.latest_status || 'ok';
}
async function loadState(r2, spec) {
  const object = await r2.get(stateKey(spec.id));
  return object ? object.json() : { chart_id: spec.id, years: [], cursor: null, latest_chart_date: null, history_complete: false };
}
async function saveState(r2, spec, state) {
  state.updated_at = Date.now();
  await r2.put(stateKey(spec.id), JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });
}
async function requestIndexPublication(env, spec) {
  await enqueue(env, { chart_id: spec.id, mode: 'publish', requested_at: Date.now() });
}
async function publishIndex(env, body, dependencies = {}) {
  const r2 = env.PAGES_RESPONSE_R2;
  const now = dependencies.now?.() ?? Date.now();
  const previous = await read(r2, 'spotify-charts', null);
  const publishedAt = Number(previous?.updated_at) || 0;
  if (publishedAt && publishedAt >= Number(body.requested_at || 0)) return;
  if (publishedAt && now - publishedAt < 30000) {
    await enqueue(env, body);
    return;
  }
  const charts = [];
  for (const spec of SPOTIFY_CHART_SOURCES) charts.push(await loadState(r2, spec));
  await save(r2, 'spotify-charts', { ok: true, updated_at: now, charts });
}
async function tokenFingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function chartAccessToken(env, fetchImpl) {
  const r2 = env.PAGES_RESPONSE_R2;
  const fingerprint = await tokenFingerprint(env.SPOTIFY_CHARTS_REFRESH_TOKEN);
  try {
    const object = await r2.get(AUTH_CACHE_KEY);
    const cache = object ? await object.json() : null;
    if (cache?.expires_at > Date.now() && cache?.refresh_fingerprints?.includes(fingerprint)
        && typeof cache.access_token === 'string') return cache.access_token;
  } catch { /* A corrupt or expired private cache is rebuilt from the Worker secret. */ }
  const auth = await refreshSpotifyChartsAccessToken(env.SPOTIFY_CHARTS_REFRESH_TOKEN, fetchImpl);
  if (auth.rotated) await updateSpotifyRefreshWorkerSecret(env, auth.refresh_token, fetchImpl);
  // Keep only the short-lived bearer in the private bucket, never the refresh token.
  // Accept both fingerprints during propagation of a rotated Worker secret.
  await r2.put(AUTH_CACHE_KEY, JSON.stringify({ access_token: auth.access_token,
    expires_at: Date.now() + Math.max(0, Math.min(3000, auth.expires_in - 120)) * 1000,
    refresh_fingerprints: [...new Set([fingerprint, await tokenFingerprint(auth.refresh_token)])],
  }), { httpMetadata: { contentType: 'application/json' } });
  return auth.access_token;
}
async function fetchChart(token, spec, date, fetchImpl, r2) {
  const response = await fetchImpl(`${API}${spec.id}/${date}`, { headers: {
    authorization: `Bearer ${token}`, accept: 'application/json', origin: 'https://charts.spotify.com', referer: 'https://charts.spotify.com/',
  }, signal: AbortSignal.timeout(20000) });
  if (response.status === 404) return null;
  if (response.status === 401) await r2.delete(AUTH_CACHE_KEY);
  if (!response.ok) {
    const error = new Error(`Spotify ${spec.id}: HTTP ${response.status}`);
    error.retryAfter = Math.max(30, Math.min(3600, Number(response.headers.get('retry-after')) || 60));
    throw error;
  }
  return normalizeJapanChart(await response.json(), spec, date === 'latest' ? '' : date);
}
async function fetchEditorialPlaylist(fetchImpl, spec, now) {
  const response = await fetchImpl(`https://open.spotify.com/embed/playlist/${spec.playlistId}`, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`Spotify playlist ${spec.id} HTTP ${response.status}`);
    error.retryAfter = Math.max(60, Math.min(3600, Number(response.headers?.get?.('retry-after')) || 600));
    throw error;
  }
  const playlist = parseSpotifyPlaylistPositions(await response.text(), spec.url);
  // Valid playlist ownership/identity is established by the requested Spotify ID,
  // not a mutable editorial title (or a false assumption of exactly 50 songs).
  if (playlist.id !== spec.playlistId || playlist.total < 10 || playlist.total > spec.limit) {
    throw new Error(`Invalid or incomplete Spotify playlist ${spec.id}`);
  }
  const date = new Date(now + 9 * 60 * 60_000).toISOString().slice(0, 10);
  return { capture: { chart_date: date, observed_at: now, status: 'ok', entries: playlist.tracks },
    total: playlist.total, name: playlist.name };
}
async function persist(r2, spec, capture) {
  const year = capture.chart_date.slice(0, 4);
  const key = spotifyChartModelKey(spec.id, year);
  const model = await read(r2, key, { ok: true, chart_id: spec.id, year, periods: [] });
  const old = model.periods.find(item => item.chart_date === capture.chart_date);
  if (old && JSON.stringify(old.entries) === JSON.stringify(capture.entries) && old.status === capture.status) return;
  model.periods = model.periods.filter(item => item.chart_date !== capture.chart_date);
  model.periods.push(capture);
  model.periods.sort((a, b) => a.chart_date.localeCompare(b.chart_date));
  await save(r2, key, model);
}
async function enqueue(env, body, delaySeconds = 30) {
  if (!env.SPOTIFY_PLAYCOUNT_QUEUE?.send) throw new Error('Spotify chart Queue missing');
  await env.SPOTIFY_PLAYCOUNT_QUEUE.send({ message_type: SPOTIFY_CHART_WORK, message_version: 1, ...body }, { delaySeconds });
}
// Cron only enqueues bounded jobs. Spotify fetch/normalization/backfill never runs in Pages HTTP.
export async function enqueueJapanCharts(env, scheduledTime = Date.now()) {
  const day = new Date(scheduledTime).toISOString().slice(0, 10);
  for (const spec of SPOTIFY_CHART_SOURCES) await enqueue(env, { chart_id: spec.id, mode: 'latest', day });
}
export async function runJapanChartWork(env, body, dependencies = {}) {
  if (RETIRED_CHART_IDS.has(body?.chart_id)) return;
  const spec = SPOTIFY_CHART_SOURCES.find(item => item.id === body?.chart_id);
  if (!spec || body.message_version !== 1 || !['latest', 'history', 'publish'].includes(body.mode)) throw new Error('Invalid chart work');
  if (body.mode === 'publish') return publishIndex(env, body, dependencies);
  const r2 = env.PAGES_RESPONSE_R2;
  const state = await loadState(r2, spec);
  if (body.mode === 'history' && (spec.type === 'playlist' || state.history_complete || !state.cursor || body.cursor !== state.cursor)) return;
  const now = dependencies.now?.() ?? Date.now();
  if (state.updated_at && now - state.updated_at < 1000) {
    await enqueue(env, body); return;
  }
  const fetchImpl = dependencies.fetchImpl || fetch;
  if (spec.type === 'playlist') {
    if (body.mode !== 'latest') return;
    // Spotify-curated playlist positions are not the discontinued Viral 50 ranking.
    // Preserve the actual playlist index, starting at 1, once per JST day.
    const { capture, total, name } = await fetchEditorialPlaylist(fetchImpl, spec, now);
    if (state.latest_chart_date && capture.chart_date < state.latest_chart_date) return;
    await persist(r2, spec, capture);
    state.latest_chart_date = capture.chart_date;
    state.earliest_chart_date ||= capture.chart_date;
    state.source_start ||= capture.chart_date;
    state.source = 'spotify-playlist-position';
    state.playlist_url = spec.url;
    state.playlist_name = name;
    state.playlist_total = total;
    state.observed_at = now;
    state.checked_at = now;
    state.latest_status = 'ok';
    state.history_complete = true; // There is no historical public playlist snapshot API.
    state.cursor = null;
    state.status = sourceStatus(state);
    delete state.error_code;
    state.years = [...new Set([...state.years, capture.chart_date.slice(0, 4)])].sort();
    await saveState(r2, spec, state);
    await requestIndexPublication(env, spec);
    return;
  }
  const accessToken = await chartAccessToken(env, fetchImpl);
  if (body.mode === 'latest') {
    const capture = await fetchChart(accessToken, spec, 'latest', fetchImpl, r2);
    if (!capture) {
      // Unsupported latest series is unavailable, never fabricated as an empty Top 200.
      state.latest_status = 'unavailable'; state.status = sourceStatus(state); state.checked_at = Date.now();
      await saveState(r2, spec, state); await requestIndexPublication(env, spec); return;
    }
    if (state.latest_chart_date && capture.chart_date < state.latest_chart_date) return;
    await persist(r2, spec, capture);
    state.source_start = capture.source_start || state.source_start || spec.start;
    state.latest_chart_date = capture.chart_date;
    state.observed_at = capture.observed_at;
    state.latest_status = 'ok';
    state.status = sourceStatus(state);
    state.checked_at = now;
    delete state.error_code;
    state.years = [...new Set([...state.years, capture.chart_date.slice(0, 4)])].sort();
    state.cursor ||= previous(capture.chart_date, spec.period);
    // Repair gaps after an outage by walking back from the new latest to the old latest.
    if (state.last_latest && state.last_latest < previous(capture.chart_date, spec.period)) {
      state.history_complete = false;
      state.resume_cursor = state.cursor;
      state.catchup_until = state.last_latest;
      state.cursor = previous(capture.chart_date, spec.period);
    }
    state.last_latest = capture.chart_date;
  } else {
    // One period per invocation avoids consecutive writes to the same R2 year/state key.
    for (let count = 0; count < 1 && state.cursor >= (state.source_start || spec.start); count++) {
      const cursor = state.cursor;
      const capture = await fetchChart(accessToken, spec, cursor, fetchImpl, r2);
      if (capture) {
        await persist(r2, spec, capture);
        state.years = [...new Set([...state.years, cursor.slice(0, 4)])].sort();
        state.earliest_chart_date = !state.earliest_chart_date || cursor < state.earliest_chart_date ? cursor : state.earliest_chart_date;
      } else state.unavailable_periods = (state.unavailable_periods || 0) + 1;
      state.cursor = previous(cursor, spec.period);
      if (state.catchup_until && state.cursor <= state.catchup_until) {
        state.cursor = state.resume_cursor;
        delete state.resume_cursor; delete state.catchup_until;
      }
    }
    state.history_complete = state.cursor < (state.source_start || spec.start);
    state.history_status = 'ok';
    state.status = sourceStatus(state);
    delete state.error_code;
  }
  await saveState(r2, spec, state);
  await requestIndexPublication(env, spec);
  if (!state.history_complete) await enqueue(env, { chart_id: spec.id, mode: 'history', cursor: state.cursor });
}
export async function processJapanChartMessage(entry, env, dependencies = {}) {
  try {
    await runJapanChartWork(env, entry.body, dependencies);
    entry.ack?.();
  } catch (error) {
    console.error(JSON.stringify({ event: 'spotify_japan_chart_failed', chart_id: entry.body?.chart_id, mode: entry.body?.mode, error: String(error.message).slice(0, 240) }));
    const spec = SPOTIFY_CHART_SOURCES.find(item => item.id === entry.body?.chart_id);
    if (spec && entry.body.mode !== 'publish') {
      try {
        const state = await loadState(env.PAGES_RESPONSE_R2, spec);
        const committed = entry.body.mode === 'history' && state.cursor !== entry.body.cursor;
        // A continuation failure must not rewrite a just-committed checkpoint.
        if (!committed && (!state.updated_at || Date.now() - state.updated_at >= 1000)) {
          if (entry.body.mode === 'latest') state.latest_status = 'error';
          else state.history_status = 'error';
          state.status = sourceStatus(state); state.checked_at = Date.now();
          state.error_code = /HTTP (\d{3})/.exec(String(error.message))?.[1]
            || /\((\d{5,6})\)/.exec(String(error.message))?.[1] || 'collection-failed';
          await saveState(env.PAGES_RESPONSE_R2, spec, state);
        }
        await requestIndexPublication(env, spec);
        if (committed) {
          await enqueue(env, { chart_id: spec.id, mode: 'history', cursor: state.cursor }, error.retryAfter || 60);
          entry.ack?.(); return;
        }
      } catch { /* Preserve the original failure; the Queue will retry. */ }
    }
    entry.retry?.({ delaySeconds: error.retryAfter || 60 });
  }
}
