import { loadMaterializedResponse } from './pages-response-store.js';
import {
  PUBLIC_R2_MODEL_KEYS,
  modelMaximumAge,
  materializedStaleMaximumAge,
  responseIsStale,
  staleMaterializedResponse,
} from './pages-response-models.js';
import { normalizeFollowersResponse } from './stationhead-followers-response.js';

const HISTORY_MODEL_KEYS = new Set(['history:daily', 'history:weekly', 'history:broadcasts']);

// History range filtering belongs to the Worker read-model boundary, never Pages.
function validHistoryDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function historyRangeError(params) {
  const from = params.get('from');
  const to = params.get('to');
  if (!from && !to) return null;
  if ((from && !validHistoryDate(from)) || (to && !validHistoryDate(to))) {
    return Response.json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  if (from && to && from > to) {
    return Response.json({ ok: false, error: 'from must not be after to' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  return null;
}

async function filterHistoryResponse(response, modelKey, params) {
  const from = params.get('from');
  const to = params.get('to');
  if ((!from && !to) || !response?.ok) return response;
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.rows)) {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const broadcasts = modelKey === 'history:broadcasts';
  const fromTs = from ? Date.parse(from + 'T00:00:00Z') : -Infinity;
  const toTs = to ? Date.parse(to + 'T00:00:00Z') + 86400000 : Infinity;
  const rows = payload.rows.filter(row => {
    if (broadcasts) {
      const timestamp = Number(row?.started_at);
      return Number.isFinite(timestamp) && timestamp >= fromTs && timestamp < toTs;
    }
    const key = String(row?.period_key || '');
    return (!from || key >= from) && (!to || key <= to);
  });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.delete('content-md5');
  headers.delete('digest');
  headers.set('x-history-read-path', 'r2-materialized-range');
  headers.set('x-history-range-filter', 'worker');
  return new Response(JSON.stringify({ ...payload, from: from || payload.from, to: to || payload.to,
    rows, read_path: 'r2-materialized-range' }), { status: response.status, headers });
}

// The DO class is exported by the shared Worker entrypoint. Never pull the
// multi-day track-history parser into the 10ms HTTP isolate on cold start.
let historyApiModulePromise;
function historyApiModule() {
  historyApiModulePromise ||= import('./pages-track-history-r2-api.js');
  return historyApiModulePromise;
}

// Pages HTTP (10ms CPU) is a thin cache/transport layer. Dynamic, potentially
// thousands-row R2 shard JSON assembly belongs to this Durable Object (30s CPU).
// Historical class/binding name is retained to avoid a migration. Canonical
// model compatibility decoding and follower normalization also run here.
export class PagesHistoryApiCoordinator {
  constructor(_state, env, dependencies = {}) {
    this.env = env;
    this.dependencies = dependencies;
  }

  async fetch(request) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const modelKey = String(url.searchParams.get('key') || '').trim();
    const isHistoryRange = HISTORY_MODEL_KEYS.has(modelKey)
      && (url.searchParams.has('from') || url.searchParams.has('to'));
    const isTrackHistoryApi = modelKey === 'track-history' && url.searchParams.get('api') === '1';
    if (url.pathname !== '/_internal/pages-response' || !PUBLIC_R2_MODEL_KEYS.has(modelKey)) {
      return new Response(null, { status: 404 });
    }
    if (!isTrackHistoryApi) {
      const invalid = isHistoryRange ? historyRangeError(url.searchParams) : null;
      if (invalid) return invalid;
      const now = this.dependencies.now?.() ?? Date.now();
      const maxAge = modelMaximumAge(modelKey, this.env);
      const staleAge = materializedStaleMaximumAge(this.env, maxAge);
      const load = this.dependencies.loadMaterializedResponse || loadMaterializedResponse;
      try {
        let response = await load(this.env?.PAGES_RESPONSE_R2, modelKey, now, staleAge);
        if (responseIsStale(response, now, maxAge)) response = staleMaterializedResponse(response);
        if (modelKey === 'followers') response = await normalizeFollowersResponse(response, now);
        if (isHistoryRange) response = await filterHistoryResponse(response, modelKey, url.searchParams);
        return response || new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
      } catch {
        return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
      }
    }
    const source = url.searchParams.get('source') || 'buddies';
    if (source !== 'buddies' && source !== 'ohisama') {
      return Response.json({ ok: false, error: 'invalid track-history source' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
    const now = this.dependencies.now?.() ?? Date.now();
    const maxAge = modelMaximumAge('track-history', this.env);
    const staleAge = materializedStaleMaximumAge(this.env, maxAge);
    try {
      const load = this.dependencies.loadTrackHistoryR2ApiResponse
        || (await historyApiModule()).loadTrackHistoryR2ApiResponse;
      return await load(this.env?.PAGES_RESPONSE_R2, request, now, staleAge);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'track_history_do_assembly_failed',
        source,
        error: String(error?.message || error).slice(0, 200),
      }));
      return new Response(null, {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '30' },
      });
    }
  }
}
