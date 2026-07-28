import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import { runPagesReadModelActions } from './run-pages-read-model-actions.mjs';

export const DASHBOARD_ONLY_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter((variant) => variant.key === 'dashboard'),
);

export async function refreshPagesDashboardActions(options = {}) {
  return runPagesReadModelActions({
    ...options,
    variants: DASHBOARD_ONLY_VARIANTS,
    maxSteps: 1,
    runTrackHistoryStep: async () => ({
      skipped: true,
      reason: 'dashboard-only-budget-fallback',
      stage: { published: true },
    }),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await refreshPagesDashboardActions()));
}
