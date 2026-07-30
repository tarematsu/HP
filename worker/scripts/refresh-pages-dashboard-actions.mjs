import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import { runPagesReadModelActions } from './run-pages-read-model-actions.mjs';

export const DASHBOARD_ONLY_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter((variant) => variant.key === 'dashboard'),
);

export const BUDGET_SAFE_VARIANTS = Object.freeze([...MATERIALIZED_API_VARIANTS]);

export async function refreshPagesDashboardActions(options = {}) {
  return runPagesReadModelActions({
    ...options,
    variants: BUDGET_SAFE_VARIANTS,
    dueKeys: BUDGET_SAFE_VARIANTS.map((variant) => variant.key),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await refreshPagesDashboardActions()));
}
