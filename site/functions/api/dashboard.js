import { onRequestGet as dashboardCore } from '../lib/dashboard-core.js';
import { augmentDashboardChartData } from '../../../packages/sh-shared/dashboard-chart-support.mjs';
import { loadDashboardDailySummaries } from '../../../packages/sh-shared/dashboard-daily-summaries.mjs';

export * from '../lib/dashboard-core.js';

function dashboardCoreContext(context) {
  const url = new URL(context.request.url);
  // The materializer adds the canonical chart history below, so the core only
  // needs current metrics and queue state here.
  url.searchParams.set('history', '0');
  return {
    ...context,
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
  const coreResponse = await dashboardCore(dashboardCoreContext(context));
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
