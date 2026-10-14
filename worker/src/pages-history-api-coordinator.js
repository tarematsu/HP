import { loadMaterializedResponse } from './pages-response-store.js';
// History range filtering belongs to the Worker read-model boundary, never Pages.
function validHistoryDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

async function filterHistoryResponse(response, modelKey, params) {
  if (!modelKey.startsWith('history:')) return response;
  const from = params.get('from');
  const to = params.get('to');
  if (!from && !to) return response;
  if ((from && !validHistoryDate(from)) || (to && !validHistoryDate(to))) {
    return Response.json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, { status: 400 });
  }
  if (from && to && from > to) {
    return Response.json({ ok: false, error: 'from must not be after to' }, { status: 400 });
  }
  if (!response?.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || !Array.isArray(payload.rows)) return response;
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
  headers.set('x-history-read-path', 'r2-materialized-range');
  headers.set('x-history-range-filter', 'worker');
  return new Response(JSON.stringify({ ...payload, from: from || payload.from, to: to || payload.to,
    rows, read_path: 'r2-materialized-range' }), { status: response.status, headers });
}


import { materializedResponseMaximumAge } from '../../packages/sh-shared/api-contract.mjs';
// The DO class is exported by the shared Worker entrypoint. Never pull the
// multi-day track-history parser into the 10ms HTTP isolate on cold start.
let historyApiModulePromise;
function historyApiModule() {
  historyApiModulePromise ||= import('./pages-track-history-r2-api.js');
  return historyApiModulePromise;
}

const DEFAULT_STALE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

// Pages HTTP (10ms CPU) is a thin cache/transport layer. Dynamic, potentially
// thousands-row R2 shard JSON assembly belongs to this Durable Object (30s CPU).
// No state is stored; two stable names shard Buddies and Ohisama reads.
export class PagesHistoryApiCoordinator {
  constructor(_state, env, dependencies = {}) {
    this.env = env;
    this.dependencies = dependencies;
  }

  async fetch(request) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const modelKey = url.searchParams.get('key') || '';
    const isHistoryRange = modelKey.startsWith('history:')
      && (url.searchParams.has('from') || url.searchParams.has('to'));
    if (url.pathname !== '/_internal/pages-response'
      || (!isHistoryRange && (modelKey !== 'track-history' || url.searchParams.get('api') !== '1'))) {
      return new Response(null, { status: 404 });
    }
    if (isHistoryRange) {
      const now = this.dependencies.now?.() ?? Date.now();
      const maxAge = materializedResponseMaximumAge(modelKey, this.env);
      const configured = Number(this.env?.PAGES_RESPONSE_STALE_MAX_AGE_MS);
      const staleAge = Number.isFinite(configured) && configured >= 0
        ? Math.max(maxAge, configured) : Math.max(maxAge, DEFAULT_STALE_MAX_AGE_MS);
      const load = this.dependencies.loadMaterializedResponse || loadMaterializedResponse;
      try {
        const response = await load(this.env?.PAGES_RESPONSE_R2, modelKey, now, staleAge);
        return await filterHistoryResponse(response, modelKey, url.searchParams)
          || new Response(null, { status: 404 });
      } catch {
        return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
      }
    }
    const source = url.searchParams.get('source') || 'buddies';
    if (source !== 'buddies' && source !== 'ohisama') {
      return Response.json({ ok: false, error: 'invalid track-history source' }, { status: 400 });
    }
    const now = this.dependencies.now?.() ?? Date.now();
    const maxAge = materializedResponseMaximumAge('track-history', this.env);
    const configuredStale = Number(this.env?.PAGES_RESPONSE_STALE_MAX_AGE_MS);
    const staleAge = Number.isFinite(configuredStale) && configuredStale >= 0
      ? Math.max(maxAge, configuredStale)
      : Math.max(maxAge, DEFAULT_STALE_MAX_AGE_MS);
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
