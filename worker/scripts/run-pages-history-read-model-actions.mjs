import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import { runPagesRevisionReadModelActions } from './run-pages-read-model-revision-actions.mjs';

export const HISTORY_READ_MODEL_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter(
    (variant) => variant.key !== 'dashboard' && variant.event_driven !== true,
  ),
);

function environmentDueKeys(variants) {
  const raw = String(process.env.PAGES_READ_MODEL_DUE_KEYS || '').trim();
  if (!raw) return null;
  const allowed = new Set(variants.map((variant) => variant.key));
  return [...new Set(raw.split(',').map((value) => value.trim()).filter((key) => allowed.has(key)))];
}

export async function runPagesHistoryReadModelActions(options = {}) {
  const variants = (options.variants || HISTORY_READ_MODEL_VARIANTS)
    .filter((variant) => variant.key !== 'dashboard' && variant.event_driven !== true);
  const requestedDueKeys = options.dueKeys ?? environmentDueKeys(variants);
  const {
    reuseOnly: _ignoredReuseOnly,
    reuseOnlyKeys: _ignoredReuseOnlyKeys,
    ...unbudgetedOptions
  } = options;

  return runPagesRevisionReadModelActions({
    ...unbudgetedOptions,
    variants,
    ...(requestedDueKeys !== null ? { dueKeys: requestedDueKeys } : {}),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runPagesHistoryReadModelActions()));
}
