import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadVariantSourceRevision,
  materializeVariant,
  runPagesReadModelActions,
} from './run-pages-read-model-actions.mjs';

const COMPACT_REVISION_KEYS = new Set([
  'history:daily',
  'history:weekly',
  'history:broadcasts',
  'host-history:summary',
]);

export async function loadCompactReadModelRevision(variant, env, now = Date.now()) {
  const key = String(variant?.key || '');
  if (!COMPACT_REVISION_KEYS.has(key)) {
    return loadVariantSourceRevision(variant, env, now);
  }
  try {
    const row = await env.OTHER_DB.prepare(`SELECT revision,updated_at
      FROM sh_read_model_revision
      WHERE model_key=?
      LIMIT 1`).bind(key).first();
    if (row) {
      return `compact:${key}:${Number(row.revision) || 0}:${Number(row.updated_at) || 0}`;
    }
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || error))) throw error;
  }
  // Migration-transition fallback only. Normal production reads one revision row.
  return loadVariantSourceRevision(variant, env, now);
}

export function materializeRevisionGatedVariant(variant, env, now, dependencies = {}) {
  return materializeVariant(variant, env, now, {
    ...dependencies,
    loadSourceRevision: dependencies.loadSourceRevision || loadCompactReadModelRevision,
  });
}

export function runPagesRevisionReadModelActions(options = {}) {
  return runPagesReadModelActions({
    ...options,
    materializeVariant: options.materializeVariant || materializeRevisionGatedVariant,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runPagesRevisionReadModelActions()));
}
