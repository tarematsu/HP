import { SPOTIFY_JP_CHARTS, spotifyChartModelKey } from '../../packages/sh-shared/spotify-charts.mjs';
import { refreshSpotifyChartsAccessToken, updateSpotifyRefreshWorkerSecret } from './spotify-artist-chart-collector.js';
import { normalizeJapanChart } from './spotify-japan-chart-data.js';
import { pagesR2ResponseKey, saveMaterializedR2Response } from './pages-response-r2.js';

export const SPOTIFY_CHART_WORK = 'spotify-japan-chart-work';
const API = 'https://charts-spotify-com-service.spotify.com/auth/v0/charts/';
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30, s-maxage=300', vary: 'accept-encoding' };
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
async function loadState(r2, spec) {
  const object = await r2.get(stateKey(spec.id));
  return object ? object.json() : { chart_id: spec.id, years: [], cursor: null, latest_chart_date: null, history_complete: false };
}
async function saveState(r2, spec, state) {
  await r2.put(stateKey(spec.id), JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });
}
async function publishIndex(r2) {
  const charts = [];
  for (const spec of SPOTIFY_JP_CHARTS) charts.push(await loadState(r2, spec));
  await save(r2, 'spotify-charts', { ok: true, charts });
}
async function fetchChart(token, spec, date, fetchImpl) {
  const response = await fetchImpl(`${API}${spec.id}/${date}`, { headers: {
    authorization: `Bearer ${token}`, accept: 'application/json', origin: 'https://charts.spotify.com', referer: 'https://charts.spotify.com/',
  }, signal: AbortSignal.timeout(20000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Spotify ${spec.id}: HTTP ${response.status}`);
    error.retryAfter = Math.max(30, Math.min(3600, Number(response.headers.get('retry-after')) || 60));
    throw error;
  }
  return normalizeJapanChart(await response.json(), spec, date === 'latest' ? '' : date);
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
  for (const spec of SPOTIFY_JP_CHARTS) await enqueue(env, { chart_id: spec.id, mode: 'latest', day });
}
export async function runJapanChartWork(env, body, dependencies = {}) {
  const spec = SPOTIFY_JP_CHARTS.find(item => item.id === body.chart_id);
  if (!spec || body.message_version !== 1 || !['latest', 'history'].includes(body.mode)) throw new Error('Invalid chart work');
  const r2 = env.PAGES_RESPONSE_R2;
  const state = await loadState(r2, spec);
  if (body.mode === 'history' && (state.history_complete || !state.cursor || body.cursor !== state.cursor)) return;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const auth = await refreshSpotifyChartsAccessToken(env.SPOTIFY_CHARTS_REFRESH_TOKEN, fetchImpl);
  if (auth.rotated) await updateSpotifyRefreshWorkerSecret(env, auth.refresh_token, fetchImpl);
  if (body.mode === 'latest') {
    const capture = await fetchChart(auth.access_token, spec, 'latest', fetchImpl);
    if (!capture) {
      // Unsupported latest series is visible as unavailable, never fabricated as an empty Top 50/200.
      state.status = 'unavailable'; state.checked_at = Date.now();
      await saveState(r2, spec, state); await publishIndex(r2); return;
    }
    if (state.latest_chart_date && capture.chart_date < state.latest_chart_date) return;
    await persist(r2, spec, capture);
    state.source_start = capture.source_start || state.source_start || spec.start;
    state.latest_chart_date = capture.chart_date;
    state.observed_at = capture.observed_at;
    state.status = 'ok';
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
    // Three periods per invocation bound JSON CPU and subrequests; progress is durable after each period.
    for (let count = 0; count < 3 && state.cursor >= (state.source_start || spec.start); count++) {
      const cursor = state.cursor;
      const capture = await fetchChart(auth.access_token, spec, cursor, fetchImpl);
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
      await saveState(r2, spec, state);
    }
    state.history_complete = state.cursor < (state.source_start || spec.start);
    state.status = 'ok';
  }
  await saveState(r2, spec, state);
  await publishIndex(r2);
  if (!state.history_complete) await enqueue(env, { chart_id: spec.id, mode: 'history', cursor: state.cursor });
}
export async function processJapanChartMessage(entry, env) {
  try {
    await runJapanChartWork(env, entry.body);
    entry.ack?.();
  } catch (error) {
    console.error(JSON.stringify({ event: 'spotify_japan_chart_failed', chart_id: entry.body?.chart_id, mode: entry.body?.mode, error: String(error.message).slice(0, 240) }));
    const spec = SPOTIFY_JP_CHARTS.find(item => item.id === entry.body?.chart_id);
    if (spec) {
      try {
        const state = await loadState(env.PAGES_RESPONSE_R2, spec);
        state.status = 'error'; state.checked_at = Date.now();
        await saveState(env.PAGES_RESPONSE_R2, spec, state);
        await publishIndex(env.PAGES_RESPONSE_R2);
        // If a later period failed after earlier periods committed, replace the
        // stale original cursor with the durable continuation before acknowledging.
        if (entry.body.mode === 'history' && state.cursor !== entry.body.cursor) {
          await enqueue(env, { chart_id: spec.id, mode: 'history', cursor: state.cursor }, error.retryAfter || 60);
          entry.ack?.(); return;
        }
      } catch { /* Preserve the original failure; the Queue will retry. */ }
    }
    entry.retry?.({ delaySeconds: error.retryAfter || 60 });
  }
}
