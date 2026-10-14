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
    if (url.pathname !== '/_internal/pages-response'
      || url.searchParams.get('key') !== 'track-history'
      || url.searchParams.get('api') !== '1') {
      return new Response(null, { status: 404 });
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
