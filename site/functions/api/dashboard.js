import { onRequestGet as dashboardCore } from '../lib/dashboard-core.js';

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
  return { ...context, env };
}

export async function onRequestGet(context) {
  return dashboardCore(factsOnlyDashboardContext(context));
}
