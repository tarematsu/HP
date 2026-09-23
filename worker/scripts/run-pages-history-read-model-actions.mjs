import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import { runPagesReadModelActions } from './run-pages-read-model-actions.mjs';

export const HISTORY_READ_MODEL_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter((variant) => variant.key !== 'dashboard'),
);

function enabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

export async function runPagesHistoryReadModelActions(options = {}) {
  const variants = (options.variants || HISTORY_READ_MODEL_VARIANTS)
    .filter((variant) => variant.key !== 'dashboard');
  const reuseOnly = options.reuseOnly
    ?? enabled(process.env.PAGES_READ_MODEL_REUSE_ONLY);

  return runPagesReadModelActions({
    ...options,
    variants,
    ...(reuseOnly ? {
      dueKeys: variants.map((variant) => variant.key),
      reuseOnlyKeys: variants.map((variant) => variant.key),
    } : {}),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runPagesHistoryReadModelActions()));
}
