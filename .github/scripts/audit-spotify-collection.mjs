// Read-only audit of persisted source evidence, never a live Spotify fetch.
import { SPOTIFY_CHART_SOURCES, spotifyChartModelKey } from '../../packages/sh-shared/spotify-charts.mjs';
import { SPOTIFY_MONTHLY_LISTENER_ARTISTS } from '../../worker/src/spotify-monthly-listeners.js';
import { pagesR2ResponseKey } from '../../worker/src/pages-response-r2.js';

const HOUR = 3600000;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? Date.parse(`${value}T00:00:00Z`) : NaN;
const row = (service, status, detail) => ({ service, status, detail });
function freshness(value, now, hours) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'UNKNOWN';
  if (value > now + HOUR) return 'FAIL';
  return now - value > hours * HOUR ? 'STALE' : 'OK';
}
async function json(r2, key) {
  const object = await r2.get(key);
  return object ? object.json() : null;
}
async function model(r2, key) {
  const envelope = await json(r2, pagesR2ResponseKey(key));
  // The remote adapter resolves immutable raw-body references to this envelope.
  return envelope?.body ? JSON.parse(envelope.body) : envelope;
}

export async function auditSpotifyCharts(r2, now = Date.now()) {
  const results = [];
  for (const spec of SPOTIFY_CHART_SOURCES) {
    const label = `spotify/${spec.id}`;
    try {
      const state = await json(r2, `spotify/charts/state/${spec.id}.json`);
      if (!state || state.chart_id !== spec.id) {
        results.push(row(label, 'UNKNOWN', 'source state missing or chart identity mismatch')); continue;
      }
      const age = spec.period === 'weekly' ? 240 : 96; // publication lag + retry grace
      const status = freshness(state.observed_at, now, 48);
      const sourceTime = date(state.latest_chart_date);
      const sourceStatus = Number.isFinite(sourceTime) ? freshness(sourceTime, now + 9 * HOUR, age) : 'UNKNOWN';
      const history = state.history_complete ? 'complete' : 'in progress';
      const evidence = `latest=${state.latest_chart_date || 'missing'}; observed=${Number.isFinite(state.observed_at) ? new Date(state.observed_at).toISOString() : 'missing'}; limits=48h check/${age}h source; history=${history}${state.history_status === 'error' ? ' (error)' : ''}`;
      if (state.latest_status !== 'ok') {
        // Do not publish arbitrary provider error strings, URLs or credentials.
        const code = /^(?:\d{3}|[a-z_]{1,40})$/.test(String(state.error_code || '')) ? `; code=${state.error_code}` : '';
        results.push(row(label, 'FAIL', `latest collection not successful${code}; ${evidence}`)); continue;
      }
      if (status !== 'OK' || sourceStatus !== 'OK') {
        results.push(row(label, [status, sourceStatus].includes('FAIL') ? 'FAIL' : [status, sourceStatus].includes('UNKNOWN') ? 'UNKNOWN' : 'STALE', evidence)); continue;
      }
      const captureModel = await model(r2, spotifyChartModelKey(spec.id, state.latest_chart_date.slice(0, 4)));
      const capture = captureModel?.periods?.find(item => item.chart_date === state.latest_chart_date);
      if (captureModel?.chart_id !== spec.id || capture?.status !== 'ok' || !Array.isArray(capture?.entries)) {
        results.push(row(label, 'UNKNOWN', `latest persisted capture missing or invalid; ${evidence}`)); continue;
      }
      // Zero matching artists is valid after a successfully validated chart fetch.
      results.push(row(label, state.history_status === 'error' ? 'FAIL' : 'OK', `${evidence}; matches=${capture.entries.length}`));
    } catch {
      results.push(row(label, 'UNKNOWN', 'R2 state/capture read or JSON decode failed'));
    }
  }
  return results;
}

export async function auditSpotifyD1(db, now = Date.now()) {
  const results = [];
  try {
    // Primary-key date range: bounded to the two most recent days, no history scan.
    const since = new Date(now - 48 * HOUR).toISOString().slice(0, 10);
    const runs = (await db.prepare(`SELECT snapshot_date,status,completed_at,updated_at,tracks_collected,
      albums_queued,albums_completed FROM sh_spotify_collection_runs
      WHERE snapshot_date>=? ORDER BY snapshot_date DESC LIMIT 3`).bind(since).all()).results || [];
    const latest = runs[0];
    const completed = runs.find(run => run.status === 'complete');
    const state = completed ? freshness(completed.completed_at, now, 48) : 'UNKNOWN';
    const terminalError = latest?.status === 'error';
    results.push(row('spotify/playcounts', terminalError ? 'FAIL' : state,
      `latest run=${latest?.snapshot_date || 'missing'}; state=${latest?.status || 'missing'}; albums=${latest?.albums_completed ?? '?'}/${latest?.albums_queued ?? '?'}; last complete=${completed?.snapshot_date || 'missing'}; tracks=${completed?.tracks_collected ?? '?'}; limit=48h`));
  } catch { results.push(row('spotify/playcounts', 'UNKNOWN', 'D1 collection-run read failed')); }
  const since = new Date(now - 48 * HOUR).toISOString().slice(0, 10);
  for (const artist of SPOTIFY_MONTHLY_LISTENER_ARTISTS) {
    const label = `spotify/monthly-listeners/${artist.artist_key}`;
    try {
      const value = await db.prepare(`SELECT snapshot_date,monthly_listeners,collected_at
        FROM sh_spotify_artist_monthly_listeners_daily
        WHERE snapshot_date>=? AND artist_key=? ORDER BY snapshot_date DESC LIMIT 1`)
        .bind(since, artist.artist_key).first();
      const state = value && Number.isSafeInteger(value.monthly_listeners) && value.monthly_listeners >= 0
        ? freshness(value.collected_at, now, 48) : 'UNKNOWN';
      results.push(row(label, state, `latest=${value?.snapshot_date || 'missing'}; limit=48h; source=${value?.collected_at ? new Date(value.collected_at).toISOString() : 'missing'}`));
    } catch { results.push(row(label, 'UNKNOWN', 'D1 artist sample read failed')); }
  }
  return results;
}
