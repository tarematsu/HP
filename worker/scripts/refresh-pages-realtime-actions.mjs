import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import { runPagesReadModelActions } from './run-pages-read-model-actions.mjs';

export const REALTIME_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter((variant) => variant.key === 'dashboard'),
);

export async function refreshPagesRealtimeActions(options = {}) {
  return runPagesReadModelActions({
    ...options,
    variants: REALTIME_VARIANTS,
    dueKeys: REALTIME_VARIANTS.map((variant) => variant.key),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await refreshPagesRealtimeActions()));
}
