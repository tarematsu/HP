import { onRequestGet as dashboardCore } from '../lib/dashboard-core.js';
import { augmentDashboardChartData } from '../lib/dashboard-chart-support.js';
import { loadDashboardDailySummaries } from '../lib/dashboard-daily-summaries.js';

export * from '../lib/dashboard-core.js';

function factsOnlyDashboardContext(context) {
  const env = Object.create(context.env || null);
  // dashboard-core still contains a rollout-era DB fallback. The public and
  // materialization entry point deliberately masks that binding so stale facts
  // fail closed instead of executing the legacy multi-million-row query.
  Object.defineProperty(env, 'DB', {
    value: null,
    enumerable: true,
    configurable: true,
  });
  const url = new URL(context.request.url);
  // The current-tab materializer loads the canonical 5-minute history once
  // below, including current_stream_count. Avoid the older duplicate history
  // read inside dashboard-core.
  url.searchParams.set('history', '0');
  return {
    ...context,
    env,
    request: new Request(url, context.request),
  };
}

async function dailySummaries(env, now) {
  try {
    return await loadDashboardDailySummaries(env?.OTHER_DB, now);
  } catch (error) {
    console.error(error);
    return loadDashboardDailySummaries(null, now);
  }
}

export async function onRequestGet(context) {
  const coreResponse = await dashboardCore(factsOnlyDashboardContext(context));
  if (!coreResponse.ok) return coreResponse;
  const payload = await coreResponse.json();
  if (!payload?.ok) return new Response(JSON.stringify(payload), {
    status: coreResponse.status,
    headers: coreResponse.headers,
  });

  const now = Date.now();
  const [chartPayload, summaries] = await Promise.all([
    augmentDashboardChartData(context.env, payload, now),
    dailySummaries(context.env, now),
  ]);
  return new Response(JSON.stringify({
    ...chartPayload,
    generated_at: now,
    history_deferred: false,
    daily_summaries: summaries,
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
