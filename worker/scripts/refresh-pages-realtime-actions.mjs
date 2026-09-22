import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import {
  materializeVariant,
  runPagesReadModelActions,
} from './run-pages-read-model-actions.mjs';

export const REALTIME_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter((variant) => variant.key === 'dashboard'),
);

function enabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

function forcedRendererRevision(options = {}) {
  const revision = String(options.revisionToken || process.env.GITHUB_SHA || '').trim();
  return `forced-realtime:${revision || Date.now()}`;
}

export async function refreshPagesRealtimeActions(options = {}) {
  const customMaterializeVariant = options.materializeVariant;
  const forceDashboardRefresh = options.forceDashboardRefresh
    ?? enabled(process.env.PAGES_READ_MODEL_FORCE_DASHBOARD);
  const rendererRevision = forceDashboardRefresh ? forcedRendererRevision(options) : null;

  return runPagesReadModelActions({
    ...options,
    variants: REALTIME_VARIANTS,
    dueKeys: REALTIME_VARIANTS.map((variant) => variant.key),
    materializeVariant: customMaterializeVariant || ((variant, env, now, dependencies) => (
      materializeVariant(variant, env, now, {
        ...dependencies,
        ...(rendererRevision ? { rendererRevision } : {}),
      })
    )),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await refreshPagesRealtimeActions()));
}
