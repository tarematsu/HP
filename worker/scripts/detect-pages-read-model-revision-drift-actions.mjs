import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIALIZED_API_VARIANTS } from '../../site/functions/lib/api-contract.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { loadCompactReadModelRevision } from './run-pages-read-model-revision-actions.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';

export const REVISION_DRIVEN_VARIANTS = Object.freeze(
  MATERIALIZED_API_VARIANTS.filter((variant) => variant.revision_driven === true),
);

function wrangler(args) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function loadPublishedEnvelope(modelKey) {
  const directory = mkdtempSync(join(workerRoot, '.pages-revision-drift-'));
  try {
    const path = join(directory, 'envelope.json');
    const key = pagesActionsR2ResponseKey(modelKey);
    if (!key) return null;
    try {
      wrangler([
        'r2', 'object', 'get', `${responseBucket}/${key}`,
        '--remote', '--file', path,
      ]);
    } catch {
      return null;
    }
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8'));
      return envelope && typeof envelope === 'object' && !Array.isArray(envelope)
        ? envelope
        : null;
    } catch {
      return null;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function detectPagesReadModelRevisionDrift(options = {}) {
  const env = options.env || {
    OTHER_DB: createWranglerRemoteD1({
      database: otherDatabase,
      cwd: workerRoot,
      wranglerScript,
      tempPrefix: '.pages-revision-drift-d1-',
    }),
  };
  const loadPublished = options.loadPublishedEnvelope || loadPublishedEnvelope;
  const loadRevision = options.loadRevision || loadCompactReadModelRevision;
  const variants = options.variants || REVISION_DRIVEN_VARIANTS;
  const dueKeys = [];
  const states = [];

  for (const variant of variants) {
    const sourceRevision = await loadRevision(variant, env, options.now ?? Date.now());
    const published = await loadPublished(variant.key);
    const publishedRevision = typeof published?.source_revision === 'string'
      ? published.source_revision
      : null;
    const due = !published || !sourceRevision || publishedRevision !== sourceRevision;
    states.push({
      key: variant.key,
      due,
      source_revision: sourceRevision,
      published_revision: publishedRevision,
      missing: !published,
    });
    if (due) dueKeys.push(variant.key);
  }

  return { due_keys: dueKeys, states };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await detectPagesReadModelRevisionDrift();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else process.stdout.write(result.due_keys.join(','));
}
